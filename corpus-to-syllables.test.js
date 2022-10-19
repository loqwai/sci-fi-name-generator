import {corpusToSyllables} from './corpus-to-syllables.js'

describe('corpusToSyllables', () => {
  it('should return an array of syllables', async () => {
    const path = './test_data/some-file.txt'
    console.log('in corpus test')
    const syllables = await corpusToSyllables(path)
    expect(syllables.length).toBeGreaterThan(5)
  })
})
