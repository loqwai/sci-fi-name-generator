const syllableRegex = /[^aeiouy]*[aeiouy]+(?:[^aeiouy]*$|[^aeiouy](?=[^aeiouy]))?/gi

export const getSyllables = (word) => {
  return word.match(syllableRegex).map(syllable => syllable.toLowerCase())
}
export default getSyllables
