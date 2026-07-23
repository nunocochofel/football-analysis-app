import type { FootballApi } from './index'

declare global {
  interface Window {
    api: FootballApi
  }
}
