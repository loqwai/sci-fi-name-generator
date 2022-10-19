const syllableRegex = /[^aeiouy]*[aeiouy]+(?:[^aeiouy]*$|[^aeiouy](?=[^aeiouy]))?/gi

const removeNonLetters = (word) => word.replace(/[^a-z]/gi, '')
export const getSyllables = (word) => {
  word = removeNonLetters(word)
  return word.match(syllableRegex).map(syllable => syllable.toLowerCase())
}
export default getSyllables
