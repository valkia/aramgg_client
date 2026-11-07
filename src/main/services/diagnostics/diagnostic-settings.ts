/** Detailed game captures are opt-in; recognition and recommendations do not depend on this flag. */
export function isGameDiagnosticsEnabled(): boolean {
  return process.env.ARAMGG_GAME_DIAGNOSTICS === '1'
}
