declare module 'dorita980' {
  export interface LocalRobot {
    start: () => Promise<unknown>
    stop: () => Promise<unknown>
    dock: () => Promise<unknown>
    find?: () => Promise<unknown>
    pause?: () => Promise<unknown>
    resume?: () => Promise<unknown>
    cleanRoom?: (args: object) => Promise<unknown>
    getRobotState?: (fields: string[]) => Promise<Record<string, unknown>>
    getStatus?: () => Promise<Record<string, unknown>>
    setCleaningPassesAuto?: () => Promise<unknown>
    setCleaningPassesOne?: () => Promise<unknown>
    setCleaningPassesTwo?: () => Promise<unknown>
    end?: (force?: boolean) => void
    on?: (event: string, listener: (...args: unknown[]) => void) => void
  }

  export interface Dorita980Module {
    Local: new (
      username: string,
      password: string,
      ip: string,
      version?: number,
      options?: Record<string, unknown>,
    ) => LocalRobot
  }

  const dorita980: Dorita980Module
  export default dorita980
}
