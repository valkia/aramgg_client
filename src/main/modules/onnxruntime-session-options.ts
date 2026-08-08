export type OrtSessionOptions = {
    intraOpNumThreads: number
    interOpNumThreads: number
    executionMode: 'sequential' | 'parallel'
    graphOptimizationLevel: 'disabled' | 'basic' | 'extended' | 'layout' | 'all'
}

type OrtLike = {
    Tensor: unknown
    InferenceSession: {
        create: (buffer: ArrayBufferLike, options?: OrtSessionOptions) => Promise<unknown>
    }
}

export function resolveOcrThreadCount(env: NodeJS.ProcessEnv = process.env): number {
    const raw = Number(env.ARAMGG_OCR_THREADS)
    return Number.isInteger(raw) && raw >= 1 && raw <= 32 ? raw : 2
}

export function createOrtSessionOptions(
    threads: number = resolveOcrThreadCount()
): OrtSessionOptions {
    return {
        intraOpNumThreads: threads,
        interOpNumThreads: 1,
        executionMode: 'sequential',
        graphOptimizationLevel: 'all',
    }
}

export function withOrtSessionOptions<T extends OrtLike>(
    ort: T,
    options: OrtSessionOptions = createOrtSessionOptions()
): T {
    return {
        ...ort,
        InferenceSession: {
            ...ort.InferenceSession,
            create: (buffer: ArrayBufferLike, extraOptions?: OrtSessionOptions) =>
                ort.InferenceSession.create(buffer, {
                    ...options,
                    ...extraOptions,
                }),
        },
    }
}
