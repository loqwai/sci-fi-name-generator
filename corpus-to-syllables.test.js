import { corpusToSyllables } from './corpus-to-syllables.js'

describe('corpusToSyllables', () => {
  describe('when the path is a single file', () => {
    let singleFileSyllables
    beforeEach(async () => {
      const path = './test_data/some-file.txt'
      singleFileSyllables = await corpusToSyllables(path)
    })
    it('should return an array of syllables', () => {
      expect(singleFileSyllables.length).toBeGreaterThan(5)
    })
    describe('when the path is a directory that contains that file', () => {
      let directorySyllables
      beforeEach(async () => {
        const path = './test_data'
        directorySyllables = await corpusToSyllables(path)
      })
      it('should return an array of syllables that is larger than the single file', () => {
        expect(directorySyllables.length).toBeGreaterThan(singleFileSyllables.length)
      })
    })
  })
  describe('when the path is a directory', () => {
    let syllables
    beforeEach(async () => {
      const path = './test_data'
      syllables = await corpusToSyllables(path)
    })
    it('should return an array of syllables', () => {
      expect(syllables.length).toBeGreaterThan(5)
    })
  })
})
