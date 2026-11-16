export function assertCstLossless(api: any, tokens: any[], source: string): { utf16Length: number; utf8Bytes: number; sha256: string }
export function assertAliasResolvesTo(api: any, document: any, tokens: any[], anchorNode: any): any
export function assertCustomTagReturnType(node: any, expected: string): void
export function assertDiagnosticPosition(document: any, code: string, expectedPosition: number[]): any
export function assertLineStarts(actual: number[], expected: number[]): void
export function assertProviderDocument(api: any, document: any, tokens: any[]): { tokenIdentity: boolean }
export function assertRootScalarValue(api: any, document: any, tokens: any[], expected: string): { value: string; tokenIdentity: true }
export function assertYamlProvider(api: any, label?: string): void
export function assertYamlResolutions(resolutions: any[], entry: string, serverRoot?: string): any[]
export function createYamlResolverHook(entry: string, resolutions: any[]): any
export function getRegisterHooks(loader?: () => Promise<any>): Promise<Function | null>
export function runBareOperation(api: any, source: string, options?: any): any
export function validateWorkerEnvelope(stdout: string, expected: { workerId: string; expectedHead: string; cellIds: string[]; expectedInputSha256?: Record<string, string> }): any
export function finalizeCellLedger(planned: string[], results: Array<{ id: string; status: 'completed' | 'failed' }>): any
