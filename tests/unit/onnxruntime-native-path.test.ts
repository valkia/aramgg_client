import path from 'path'
import { describe, expect, it } from 'vitest'
import { getOnnxruntimeNativeDirCandidates } from '../../src/main/modules/onnxruntime-native-path.ts'

describe('onnxruntime native path candidates', () => {
  it('prefers configured native dir', () => {
    const candidates = getOnnxruntimeNativeDirCandidates({
      configuredDir: 'E:\\custom\\onnxruntime',
      resourcesPath: 'E:\\app\\resources',
      cwd: 'E:\\repo',
      moduleDir: 'E:\\repo\\src\\main\\modules',
      packageDir: 'E:\\repo\\node_modules\\onnxruntime-node',
      platform: 'win32',
      arch: 'x64',
    })

    expect(candidates[0]).toBe('E:\\custom\\onnxruntime')
  })

  it('adds the app.asar.unpacked native dir for packaged installs', () => {
    const candidates = getOnnxruntimeNativeDirCandidates({
      configuredDir: '',
      resourcesPath: 'E:\\aramgg\\aramgg_client\\resources',
      cwd: 'E:\\repo',
      moduleDir: 'E:\\aramgg\\aramgg_client\\resources\\app.asar\\dist-electron',
      packageDir: 'E:\\aramgg\\aramgg_client\\resources\\app.asar\\node_modules\\onnxruntime-node',
      platform: 'win32',
      arch: 'x64',
    })

    const expected = path.join(
      'E:\\aramgg\\aramgg_client\\resources\\app.asar.unpacked',
      'node_modules',
      'onnxruntime-node',
      'bin',
      'napi-v6',
      'win32',
      'x64'
    )
    expect(candidates).toContain(expected)
  })
})
