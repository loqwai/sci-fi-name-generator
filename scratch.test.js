import { corpusToSyllables } from './corpus-to-syllables.js'
import {writeFileSync} from 'fs'
import pronounceable from 'pronounceable'

const randomInRange = (min, max) => {
  // thanks to copilot, that cited the actual source
  // https://stackoverflow.com/a/1527820/10840
  return Math.floor(Math.random() * (max - min + 1) + min)
}
const wordFromSyllables = (syllables) => {
  const syllableCount = syllables.length
  const wordLength = randomInRange(2, 4)
  const word = new Array(wordLength).fill(0).map(() => {
    const syllableIndex = randomInRange(0, syllableCount - 1)
    return syllables[syllableIndex]
  })
  return word.join('')
}
describe('When using the test harness to run the program', () => {
  describe('when the path is the phillipkdick folder', () => {
    let syllablesShorterThan4
    beforeEach(async () => {
      const phillipPath = './data/phillip_k_dick'
      const janePath = './data/jane_austin'
      const asimovPath = './data/asimov'
      const phillipSyllables = await corpusToSyllables(phillipPath)
      const asimovSyllables = await corpusToSyllables(asimovPath)
      const janeSyllables = await corpusToSyllables(janePath)

      const uniquePhillipSyllables = [...new Set(phillipSyllables)]
      const uniqueJaneSyllables = [...new Set(janeSyllables)]
      const uniqueAsimovSyllables = [...new Set(asimovSyllables)]

      const uniqueToPhillipSyllables = uniquePhillipSyllables.filter((syllable) => {
        return !uniqueJaneSyllables.includes(syllable)
      })
      const phillipAndAsimovSyllables = uniquePhillipSyllables.filter((syllable) => {
        return uniqueAsimovSyllables.includes(syllable)
      })
      console.log(phillipAndAsimovSyllables)
      syllablesShorterThan4 = phillipAndAsimovSyllables.filter(s => s.length < 4)
      // writeFileSync('./data/jane_syllables.json', JSON.stringify(phillipSyllables, null, 2))
    })
    it('should return an array of syllables', () => {
      expect(syllablesShorterThan4.length).toBeGreaterThan(5)
      const manyWords = new Array(100).fill(0).map(() => wordFromSyllables(syllablesShorterThan4))
      const wordsLongerThan5 = manyWords.filter(word => word.length > 5)
      const pronounceableWords = wordsLongerThan5.filter(pronounceable.test)
      console.log(pronounceableWords.join('\n'))
    })
  })
})
const okOptions = [
  'tentani',
  'valthec',
  'mareki',
  'kelrav',
  'vappog',
  'ntuntu',
  'bionrigge',
  'koichy',
  // 'jetmod', domain in use
]
