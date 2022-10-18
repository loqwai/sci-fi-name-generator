import {syllabify} from './syllable-parser.js'


describe('syllabify', () => {
  it('should return an array of syllables', () => {
    const words = 'syllable'
    const syllables = syllabify(words).sort()
    expect(syllables).toEqual(['syl', 'lab', 'le'].sort())
  })

  describe("When the word has capital letters", () => {
    it('should return an array of lower-case syllables', () => {
      const words = 'Syllable'
      const syllables = syllabify(words).sort()
      expect(syllables).toEqual(['syl', 'lab', 'le'].sort())
    })
  })
})
