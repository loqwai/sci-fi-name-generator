import {getSyllables} from './syllable-parser.js'


describe('getSyllables', () => {
  it('should return an array of syllables', () => {
    const words = 'syllable'
    const syllables = getSyllables(words).sort()
    expect(syllables).toEqual(['syl', 'lab', 'le'].sort())
  })

  describe("When the word has capital letters", () => {
    it('should return an array of lower-case syllables', () => {
      const words = 'Syllable'
      const syllables = getSyllables(words).sort()
      expect(syllables).toEqual(['syl', 'lab', 'le'].sort())
    })
  })
  describe("When the word has a hyphen", () => {
    it('should return an array of syllables', () => {
      const words = 'syll-able'
      const syllables = getSyllables(words).sort()
      expect(syllables).toEqual(['syl', 'lab', 'le'].sort())
    })
  })
})
