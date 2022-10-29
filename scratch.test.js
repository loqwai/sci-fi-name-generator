import { corpusToSyllables } from './corpus-to-syllables.js'
import { wordsInCorpus } from './corpus-to-syllables.js'

import {writeFileSync} from 'fs'
import pronounceable from 'pronounceable'

const randomInRange = (min, max) => {
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

const intersect = (...sets) => {
  return [... sets.reduce((a, b) => {
    const uniqueA = unique(a)
    const uniqueB = unique(b)
    return new Set([...uniqueA].filter((x) => uniqueB.includes(x))).values()
  })]
}

const difference = (...sets) => {
  return [...sets.reduce((a, b) => {
    const uniqueA = unique(a)
    const uniqueB = unique(b)
    return new Set([...uniqueA].filter((x) => !uniqueB.includes(x))).values()
  })]
}

const join = (...sets) => {
  return [...sets.reduce((a, b) => {
    return new Set([...unique(a), ...unique(b)]).values()
  })]
}

const unique = (a) => {
  return [...new Set(a)]
}

describe('When using the test harness to run the program', () => {
  describe('when curious about word sets between authors', () => {
    let words
    beforeEach(async () => {
      const phillipPath = './data/phillip_k_dick'
      const janePath = './data/jane_austin'
      const asimovPath = './data/asimov'
      const dickWords = await wordsInCorpus(phillipPath) //thanks for the variable name, copilot
      const janeWords = await wordsInCorpus(janePath)
      const asimovWords = await wordsInCorpus(asimovPath)

      words = difference(
        intersect(dickWords, asimovWords),
        janeWords,
      )
    })
    it('should return an array of words', () => {
      expect(words.length).toBeGreaterThan(5)
      console.log({words})
    })
  })
  describe('when we get all the syllables in asimov, jane, and phillp', () => {
    let syllables
    beforeEach(async () => {
      const phillipPath = './data/phillip_k_dick'
      const janePath = './data/jane_austin'
      const asimovPath = './data/asimov'

      const philSyl = unique(await corpusToSyllables(phillipPath))
      const asimovSyl = unique( await corpusToSyllables(asimovPath))
      const janeSyl = unique( await corpusToSyllables(janePath))

      syllables = difference(philSyl, join(asimovSyl, janeSyl))

      syllables = syllables.filter(s => s.length < 4)
      // writeFileSync('./data/jane_syllables.json', JSON.stringify(phillipSyllables, null, 2))
      console.log(syllables)
    })
    it('should return an array of syllables', () => {
      expect(syllables.length).toBeGreaterThan(5)
      const manyWords = new Array(100).fill(0).map(() => wordFromSyllables(syllables))
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
  'waydir',
  'ntuntu',
  'bionrigge',
  'koichy',
  'nerpab',
  // 'jetmod', domain in use
]
