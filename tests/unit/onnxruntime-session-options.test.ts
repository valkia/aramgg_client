import { describe, expect, it, vi } from 'vitest'
import {
    createOrtSessionOptions,
    resolveOcrThreadCount,
    withOrtSessionOptions,
} from '../../src/main/modules/onnxruntime-session-options.ts'

describe('onnxruntime session options', () => {
    it('defaults OCR inference to a bounded thread pool', () => {
        expect(createOrtSessionOptions(2)).toEqual({
            intraOpNumThreads: 2,
            interOpNumThreads: 1,
            executionMode: 'sequential',
            graphOptimizationLevel: 'all',
        })
    })

    it('honors ARAMGG_OCR_THREADS only for valid ranges', () => {
        expect(resolveOcrThreadCount({ ARAMGG_OCR_THREADS: '3' } as NodeJS.ProcessEnv)).toBe(3)
        expect(resolveOcrThreadCount({ ARAMGG_OCR_THREADS: '0' } as NodeJS.ProcessEnv)).toBe(2)
        expect(resolveOcrThreadCount({ ARAMGG_OCR_THREADS: 'abc' } as NodeJS.ProcessEnv)).toBe(2)
        expect(resolveOcrThreadCount({} as NodeJS.ProcessEnv)).toBe(2)
    })

    it('wraps InferenceSession.create with bounded options', async () => {
        const create = vi.fn(async () => ({}))
        const ort = {
            Tensor: class {},
            InferenceSession: { create },
        }
        const wrapped = withOrtSessionOptions(ort, createOrtSessionOptions(4))
        await wrapped.InferenceSession.create(new ArrayBuffer(8))

        expect(create).toHaveBeenCalledWith(expect.any(ArrayBuffer), {
            intraOpNumThreads: 4,
            interOpNumThreads: 1,
            executionMode: 'sequential',
            graphOptimizationLevel: 'all',
        })
    })
})
