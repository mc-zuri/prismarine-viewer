/**
 * @jest-environment node
 */
/* eslint-env jest */
const { getVersion, nearestBedrockVersion } = require('../viewer/lib/version')

describe('Bedrock versions', () => {
  test('a version draws with the newest supported one not newer than it', () => {
    expect(getVersion('bedrock_1.21.2')).toBe('bedrock_1.21.0')
    expect(getVersion('bedrock_1.0.0')).toBe('bedrock_1.0')
    expect(getVersion('bedrock_0.14.3')).toBe('bedrock_0.14')
  })

  test('the nearest of candidates: itself (1.0 for 1.0.0), else of its major the newest before it, else the oldest after it', () => {
    const candidates = ['bedrock_0.14', 'bedrock_1.0', 'bedrock_1.19.20', 'bedrock_1.19.60']
    expect(nearestBedrockVersion('bedrock_1.0', candidates)).toBe('bedrock_1.0')
    expect(nearestBedrockVersion('bedrock_1.0.0', candidates)).toBe('bedrock_1.0')
    expect(nearestBedrockVersion('bedrock_0.14.3', candidates)).toBe('bedrock_0.14')
    expect(nearestBedrockVersion('bedrock_1.19.62', candidates)).toBe('bedrock_1.19.60')
    expect(nearestBedrockVersion('bedrock_1.19.10', candidates)).toBe('bedrock_1.19.20')
    expect(nearestBedrockVersion('bedrock_1.18.0', candidates)).toBe(null)
  })
})
