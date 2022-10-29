import { corpusToSyllables } from './corpus-to-syllables.js'

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
    let singleFileSyllables
    beforeEach(async () => {
      const path = './data/phillip_k_dick'
      singleFileSyllables = await corpusToSyllables(path)
    })
    it('should return an array of syllables', () => {
      expect(singleFileSyllables.length).toBeGreaterThan(5)
      const manyWords = new Array(100).fill(0).map(() => wordFromSyllables(singleFileSyllables))
      console.log(manyWords.join('\n'))
    })
  })
})
