import type { API, Logging, PlatformAccessory } from 'homebridge'

import type { MatterAccessory } from 'homebridge'

import type { CloudDiscoveryResult } from './cloudDiscovery.js'
import type { RobotFactory } from './accessory.js'
import type { DeviceConfig, RoombOMaticConfig } from './settings.js'

import { RoombaAccessory } from './accessory.js'
import { discoverCloudRobots } from './cloudDiscovery.js'
import { backoffDelayMs, planDeviceDiscovery, sanitizeDevice, usableLocalDevice } from './discoveryPlan.js'
import { writeMatterDeviceIndex, type MatterDeviceIndexEntry } from './matterPairing.js'
import { safeError } from './redact.js'
import { matterPreferenceEnabled, PLATFORM_NAME, PLUGIN_NAME } from './settings.js'

interface MatterApi {
  uuid?: { generate: (value: string) => string }
  deviceTypes?: { RoboticVacuumCleaner?: unknown }
  registerPlatformAccessories?: (plugin: string, platform: string, accessories: MatterAccessory[]) => Promise<void>
  updateAccessoryState?: (uuid: string, cluster: string, attributes: Record<string, unknown>) => Promise<void>
}

type HomebridgeApi = API & {
  matter?: MatterApi
  isMatterEnabled?: () => boolean
}

export class RoombOMaticPlatform {
  private readonly accessories = new Map<string, PlatformAccessory>()
  private readonly sessions = new Map<string, RoombaAccessory>()
  private readonly matterRegistered = new Set<string>()
  private readonly cachedMatter = new Map<string, MatterAccessory>()
  private readonly matterIndex: MatterDeviceIndexEntry[] = []
  private retryAttempt = 0
  private retryTimer?: ReturnType<typeof setTimeout>
  private discovering = false
  private discoverAgain = false

  constructor(
    private readonly log: Logging,
    private readonly config: RoombOMaticConfig,
    private readonly api: HomebridgeApi,
    private readonly deps: {
      discoverCloud?: (email: string, password: string) => Promise<CloudDiscoveryResult>
      robotFactory?: RobotFactory
    } = {},
  ) {
    this.api.on('didFinishLaunching', () => {
      void this.discoverDevices()
    })
    this.api.on('shutdown', () => {
      this.shutdown()
    })
  }

  configureAccessory(accessory: PlatformAccessory): void {
    this.log.info(`Configuring cached accessory: ${accessory.displayName}`)
    this.accessories.set(accessory.UUID, accessory)
  }

  configureMatterAccessory(accessory: MatterAccessory): void {
    if (!accessory?.UUID) {
      return
    }
    this.cachedMatter.set(accessory.UUID, accessory)
    this.log.info(`Restoring Matter accessory: ${accessory.displayName}`)
  }

  async discoverDevices(): Promise<void> {
    if (this.discovering) {
      this.discoverAgain = true
      return
    }
    this.discovering = true
    try {
      await this.discoverOnce()
    }
    finally {
      this.discovering = false
      if (this.discoverAgain) {
        this.discoverAgain = false
        await this.discoverDevices()
      }
    }
  }

  shutdown(): void {
    if (this.retryTimer) {
      clearTimeout(this.retryTimer)
      this.retryTimer = undefined
    }
    for (const session of this.sessions.values()) {
      session.dispose()
    }
    this.sessions.clear()
  }

  private async discoverOnce(): Promise<void> {
    if (!this.config) {
      this.log.error('No devices configured.')
      return
    }
    const plan = await planDeviceDiscovery({
      config: this.config,
      discoverCloud: (email, password) => this.discoverCloud(email, password),
    })
    if (plan.retry) {
      this.log.warn('Cloud discovery failed or returned no robots. Cached accessories stay registered.')
      this.reviveCached()
      this.scheduleRetry()
      return
    }
    if (this.retryTimer) {
      clearTimeout(this.retryTimer)
      this.retryTimer = undefined
    }
    this.retryAttempt = 0
    if (plan.source === 'none') {
      this.log.error('No devices configured.')
      this.reviveCached()
      return
    }
    if (plan.devices.length === 0) {
      this.log.error('Devices are configured but none have name, blid, robot password, and IP address. Cloud login was not used.')
      this.reviveCached()
      return
    }
    const seen = new Set<string>()
    for (const device of plan.devices) {
      const uuid = this.api.hap.uuid.generate(device.blid)
      seen.add(uuid)
      this.publishDevice(device)
    }
    if (plan.authoritative) {
      this.unregisterMissing(seen)
      return
    }
    for (const [uuid, accessory] of this.accessories) {
      if (!seen.has(uuid)) {
        this.reviveOne(accessory)
      }
    }
  }

  private async discoverCloud(email: string, password: string): Promise<CloudDiscoveryResult> {
    const discover = this.deps.discoverCloud ?? discoverCloudRobots
    try {
      return await discover(email, password)
    }
    catch (error) {
      this.log.error(`Cloud discovery failed — ${safeError(error, [password])}`)
      return { ok: false, robots: [] }
    }
  }

  private publishDevice(device: DeviceConfig): void {
    const clean = sanitizeDevice(device)
    const uuid = this.api.hap.uuid.generate(clean.blid)
    const existing = this.accessories.get(uuid)
    if (existing) {
      this.log.info(`Restoring existing accessory: ${existing.displayName}`)
      existing.displayName = clean.name
      existing.context.device = clean
      existing.category = this.api.hap.Categories.FAN
      this.attach(existing, clean)
      this.api.updatePlatformAccessories([existing])
      return
    }
    this.log.info(`Adding new accessory: ${clean.name}`)
    const accessory = new this.api.platformAccessory(clean.name, uuid)
    accessory.category = this.api.hap.Categories.FAN
    accessory.context.device = clean
    this.accessories.set(uuid, accessory)
    this.attach(accessory, clean)
    this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory])
  }

  private unregisterMissing(seen: Set<string>): void {
    const stale: PlatformAccessory[] = []
    for (const [uuid, accessory] of this.accessories) {
      if (seen.has(uuid)) {
        continue
      }
      this.sessions.get(uuid)?.dispose()
      this.sessions.delete(uuid)
      this.accessories.delete(uuid)
      stale.push(accessory)
    }
    if (stale.length > 0) {
      this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, stale)
      this.log.info(`Removed ${stale.length} accessory(ies) that are no longer configured.`)
    }
  }

  private reviveCached(): void {
    for (const accessory of this.accessories.values()) {
      this.reviveOne(accessory)
    }
  }

  private reviveOne(accessory: PlatformAccessory): void {
    const stored = accessory.context?.device as DeviceConfig | undefined
    if (!usableLocalDevice(stored)) {
      this.log.warn(`Leaving cached accessory registered: ${accessory.displayName}`)
      return
    }
    if (this.sessions.has(accessory.UUID)) {
      return
    }
    this.attach(accessory, sanitizeDevice(stored))
  }

  private attach(accessory: PlatformAccessory, device: DeviceConfig): void {
    let session = this.sessions.get(accessory.UUID)
    if (!session) {
      session = new RoombaAccessory(this.log, this.api, accessory, device, {
        robotFactory: this.deps.robotFactory,
        matter: this.sessionMatter(),
      })
      this.sessions.set(accessory.UUID, session)
    }
    void this.publishMatter(session, device)
  }

  private sessionMatter(): MatterApi | undefined {
    const matter = this.matterApi()
    if (!matterPreferenceEnabled(this.config.enableMatter, Boolean(matter))) {
      return undefined
    }
    return matter
  }

  private matterApi(): MatterApi | undefined {
    if (typeof this.api.isMatterEnabled === 'function' && !this.api.isMatterEnabled()) {
      return undefined
    }
    return this.api.matter
  }

  private async publishMatter(session: RoombaAccessory, device: DeviceConfig): Promise<void> {
    const matter = this.matterApi()
    const deviceType = matter?.deviceTypes?.RoboticVacuumCleaner
    if (!matterPreferenceEnabled(this.config.enableMatter, Boolean(deviceType && matter?.registerPlatformAccessories))) {
      return
    }
    if (!session.matterUuid || this.matterRegistered.has(session.matterUuid)) {
      return
    }
    const definition = session.buildMatterDefinition(deviceType)
    if (!definition) {
      return
    }
    const { areas: _areas, ...fresh } = definition
    const cached = this.cachedMatter.get(fresh.UUID)
    const matterAccessory = cached ? Object.assign(cached, fresh) : fresh
    try {
      await matter!.registerPlatformAccessories!(PLUGIN_NAME, PLATFORM_NAME, [matterAccessory as MatterAccessory])
      this.matterRegistered.add(fresh.UUID)
      await this.pushInitialMatterState(matter!, fresh.UUID, fresh.clusters)
      this.rememberMatterDevice(device.name, fresh.serialNumber, fresh.UUID)
      this.log.info(`Published Matter vacuum '${device.name}'. Pair it from the plugin page with its own code, not the Homebridge bridge code.`)
    }
    catch (error) {
      this.log.error(`${device.name}: Matter publish failed — ${safeError(error, [device.robotpwd, device.blid])}. The HomeKit Fan is still available.`)
    }
  }

  private async pushInitialMatterState(
    matter: MatterApi,
    uuid: string,
    clusters: Record<string, unknown>,
  ): Promise<void> {
    if (!matter.updateAccessoryState) {
      return
    }
    const updates: Array<[string, Record<string, unknown>]> = []
    for (const [cluster, value] of Object.entries(clusters)) {
      if (!value || typeof value !== 'object') {
        continue
      }
      const attributes = value as Record<string, unknown>
      const live: Record<string, unknown> = {}
      if ('currentMode' in attributes) {
        live.currentMode = attributes.currentMode
      }
      if ('operationalState' in attributes) {
        live.operationalState = attributes.operationalState
      }
      if ('batPercentRemaining' in attributes) {
        live.batPercentRemaining = attributes.batPercentRemaining
        live.batChargeLevel = attributes.batChargeLevel
      }
      if ('selectedAreas' in attributes) {
        live.selectedAreas = attributes.selectedAreas
      }
      if (Object.keys(live).length > 0) {
        updates.push([cluster, live])
      }
    }
    for (const [cluster, attributes] of updates) {
      try {
        await matter.updateAccessoryState(uuid, cluster, attributes)
      }
      catch (error) {
        this.log.warn(`Matter state for ${cluster} was not accepted yet — ${safeError(error)}`)
      }
    }
  }

  private rememberMatterDevice(name: string, serialNumber: string, uuid: string): void {
    const existing = this.matterIndex.findIndex(device => device.uuid === uuid)
    const entry = { name, serialNumber, uuid }
    if (existing >= 0) {
      this.matterIndex[existing] = entry
    }
    else {
      this.matterIndex.push(entry)
    }
    try {
      const storage = this.api.user?.storagePath?.()
      if (storage) {
        writeMatterDeviceIndex(storage, this.matterIndex)
      }
    }
    catch (error) {
      this.log.warn(`Could not record the Matter pairing index — ${safeError(error)}`)
    }
  }

  private scheduleRetry(): void {
    if (this.retryTimer) {
      return
    }
    const delay = backoffDelayMs(this.retryAttempt)
    this.retryAttempt += 1
    this.log.warn(`Retrying cloud discovery in ${Math.round(delay / 1000)}s.`)
    this.retryTimer = setTimeout(() => {
      this.retryTimer = undefined
      void this.discoverDevices()
    }, delay)
    this.retryTimer.unref?.()
  }
}
