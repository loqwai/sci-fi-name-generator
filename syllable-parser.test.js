import {syllabify} from './syllable-parser.js'


describe('syllabify', () => {
  it('should return an array of syllables', () => {
    const words = 'syllable'
    const syllables = syllabify(words)
    expect(syllables).toEqual(['syll', 'a', 'ble'])
  })
})
