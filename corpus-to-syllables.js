import {readFile,stat, readdir} from 'fs/promises'
import {getSyllables} from './syllable-parser'

const corpusToSyllables = async (path) => {
  console.log('corpusToSyllables', {path})
  const stats = await stat(path)

  if (stats.isFile()) return await syllablesInFile(path)
  if (stats.isDirectory()) {
    console.log('is directory')
    const files = await readdir(path)
    const syllables = files.map(f => syllablesInFile(f))
    return syllables
  }
}

const syllablesInFile = async (path) => {
  console.log('syllablesInFile', {path})
  const text = await readFile(path, 'utf8')
  const syllables = getSyllables(text)
  console.log('syllables', {syllables})
  return syllables
}

export {corpusToSyllables}
