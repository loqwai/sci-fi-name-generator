import { corpusToSyllables } from './corpus-to-syllables.js'
import { wordsInCorpus } from './corpus-to-syllables.js'
import {getSyllables} from './syllable-parser.js'

import { writeFileSync } from 'fs'
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

const generateWords = (syllables, count=100,minWordLength=5) => {
  return new Array(count)
    .fill(0)
    .map(() => wordFromSyllables(syllables))
    .filter(w => w.length >= minWordLength)
    .filter(pronounceable.test)
}

const intersect = (...sets) => {
  return [...sets.reduce((a, b) => {
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
    describe("when we read the words from all the authors", () => {
      let phillipWords, janeWords, asimovWords
      beforeAll(async () => {
        const phillipPath = './data/phillip_k_dick'
        const janePath = './data/jane_austin'
        const asimovPath = './data/asimov'
        phillipWords = await wordsInCorpus(phillipPath) //thanks for the variable name, copilot
        janeWords = await wordsInCorpus(janePath)
        asimovWords = await wordsInCorpus(asimovPath)
      })
      describe('when you want some examples of how to use the word sets', () => {
        describe('when finding words unique to asimov', () => {
          beforeEach(() => {
            words = difference(
              asimovWords,
              janeWords,
              phillipWords,
            ).sort()
          })

          it('should return an array of words', () => {
            expect(words.length).toBeLessThan(asimovWords.length)
            console.log({ asimovWords: words })
          })
        })
        describe('when finding words unique to jane', () => {
          beforeEach(() => {
            words = difference(
              janeWords,
              asimovWords,
              phillipWords,
            ).sort()
          })
          it('should return an array of words', () => {
            expect(words.length).toBeLessThan(janeWords.length)
          })
          it('should return an array with no words in common with asimov', () => {
            const asimovIntersection = intersect(words, asimovWords)
            expect(asimovIntersection.length).toBe(0)
          })
          it('should return an array with no words in common with Phillip', () => {
            const phillipIntersection = intersect(words, phillipWords)
            expect(phillipIntersection.length).toBe(0)
          })
          it('should return an array that is a subset of the words in Jane', () => {
            const janeIntersection = intersect(words, janeWords)
            expect(janeIntersection.length).toBe(words.length)
          })
        })
        describe('wait, did Phillip and Asimov both reference Detroit?', () => {
          it('should apparently be true', () => {
            expect(phillipWords.includes('detroit')).toBe(true)
            expect(asimovWords.includes('detroit')).toBe(true)
          })
          describe('when finding words both Asimov and Phillip wrote, but not Jane', () => {
            beforeEach(() => {
              words = difference(
                intersect(asimovWords, phillipWords),
                janeWords,
              )
            })
            it('should return an array of words', () => {
              expect(words.length).toBeLessThan(asimovWords.length)
              // console.log(JSON.stringify(words,null,2))
            })
          })
        })
        describe('a scratchpad for testing out these things', () => {
          let syllables
          beforeEach(() => {
            words = join(
              phillipWords,
              janeWords,
              asimovWords,
            )
            syllables = words.map(word => getSyllables(word)).flat()
          })
          it('should return an array of words', () => {
            expect(words.length).toBeGreaterThan(0)
            console.log({syllables})
          })
        })
      })
    })
  })
  describe('when we get all the syllables in asimov, jane, and phillp', () => {
    let syllables
    beforeEach(async () => {
      const phillipPath = './data/phillip_k_dick'
      const janePath = './data/jane_austin'
      const asimovPath = './data/asimov'

      const philSyl = unique(await corpusToSyllables(phillipPath))
      const asimovSyl = unique(await corpusToSyllables(asimovPath))
      const janeSyl = unique(await corpusToSyllables(janePath))

      syllables = difference(philSyl, join(asimovSyl, janeSyl))

      syllables = syllables.filter(s => s.length < 4)
      // writeFileSync('./data/jane_syllables.json', JSON.stringify(phillipSyllables, null, 2))
      console.log(syllables)
    })
    it('should return an array of syllables', () => {
      expect(syllables.length).toBeGreaterThan(5)
      const words = generateWords(syllables, 100, 5)
      console.log(words.join('\n'))
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
