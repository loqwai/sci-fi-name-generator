import { corpusToSyllables } from './corpus-to-syllables.js'

describe('When using the test harness to run the program', () => {
  describe('when the path is the phillipkdick folder', () => {
    let singleFileSyllables
    beforeEach(async () => {
      const path = './data/phillip_k_dick'
      singleFileSyllables = await corpusToSyllables(path)
    })
    it('should return an array of syllables', () => {
      console.log(singleFileSyllables)
      expect(singleFileSyllables.length).toBeGreaterThan(5)
    })
  })
})
