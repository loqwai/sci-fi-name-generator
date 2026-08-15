// Corpus definitions for the name generator.
//
// Each "source" is a pickable chip in the UI. A source maps to one or more raw
// text files in ../../data. The 63 books in data/top100 are ALSO unioned into a
// single hidden source, `common`, which is the default "but not..." exclusion --
// that is the set that makes generated names stop sounding like real English.

const G = (id) => `top100/gutenberg.org!ebooks!${id}.txt.utf-8.txt`

// group: used to cluster chips in the UI
export const SOURCES = [
  // --- the original five author folders (his data, his recipes) ---
  { id: 'lovecraft', label: 'Lovecraft', group: 'weird', dirs: ['lovecraft'] },
  { id: 'stoker', label: 'Bram Stoker', group: 'weird', dirs: ['bram_stoker'], files: [G(345)] },
  { id: 'poe', label: 'Edgar Allan Poe', group: 'weird', files: [G(2148)] },
  { id: 'shelley', label: 'Frankenstein', group: 'weird', files: [G(42324)] },
  { id: 'faustus', label: 'Doctor Faustus', group: 'weird', files: [G(779)] },
  { id: 'kabbalah', label: 'The Kabbalah', group: 'weird', files: [G(69243)] },
  { id: 'sleepyhollow', label: 'Sleepy Hollow', group: 'weird', files: [G(41)] },

  { id: 'pkd', label: 'Philip K. Dick', group: 'scifi', dirs: ['phillip_k_dick'] },
  { id: 'asimov', label: 'Asimov', group: 'scifi', dirs: ['asimov'] },
  { id: 'wells', label: 'H. G. Wells', group: 'scifi', files: [G(36)] },
  { id: 'holmes', label: 'Sherlock Holmes', group: 'scifi', files: [G(244)] },

  { id: 'shakespeare', label: 'Shakespeare', group: 'classic', files: [G(100)] },
  { id: 'bible', label: 'The Bible', group: 'classic', files: [G(10)] },
  { id: 'homer', label: 'Homer', group: 'classic', files: [G(1727), G(6130)] },
  { id: 'myths', label: 'Greek Myths', group: 'classic', files: [G(22381)] },
  { id: 'quixote', label: 'Don Quixote', group: 'classic', files: [G(996)] },
  { id: 'dumas', label: 'Dumas', group: 'classic', files: [G(1184), G(1259)] },
  { id: 'kamasutra', label: 'The Kama Sutra', group: 'classic', files: [G(27827)] },

  { id: 'austen', label: 'Jane Austen', group: 'novel', dirs: ['jane_austin'], files: [G(105), G(158)] },
  { id: 'dickens', label: 'Dickens', group: 'novel', files: [G(46), G(730), G(766)] },
  { id: 'tolstoy', label: 'Tolstoy', group: 'novel', files: [G(1399), G(2600)] },
  { id: 'bronte', label: 'Wuthering Heights', group: 'novel', files: [G(768)] },
  { id: 'wilde', label: 'Oscar Wilde', group: 'novel', files: [G(174)] },
  { id: 'gatsby', label: 'The Great Gatsby', group: 'novel', files: [G(64317)] },
  { id: 'hawthorne', label: 'The Scarlet Letter', group: 'novel', files: [G(25344)] },
  { id: 'eliot', label: 'Middlemarch', group: 'novel', files: [G(145)] },
  { id: 'london', label: 'Call of the Wild', group: 'novel', files: [G(215)] },
  { id: 'stevenson', label: 'Treasure Island', group: 'novel', files: [G(120)] },
  { id: 'alcott', label: 'Little Women', group: 'novel', files: [G(37106), G(514)] },
  { id: 'montgomery', label: 'Anne of Green Gables', group: 'novel', files: [G(45), G(67979)] },

  { id: 'nietzsche', label: 'Nietzsche', group: 'thought', files: [G(4363)] },
  { id: 'plato', label: 'Plato', group: 'thought', files: [G(1497)] },
  { id: 'machiavelli', label: 'Machiavelli', group: 'thought', files: [G(1232)] },
  { id: 'emerson', label: 'Emerson', group: 'thought', files: [G(16643)] },
  { id: 'gibran', label: 'The Prophet', group: 'thought', files: [G(58585)] },
  { id: 'hesse', label: 'Siddhartha', group: 'thought', files: [G(2500)] },
  { id: 'wagner', label: 'Wagner', group: 'thought', files: [G(5197)] },

  { id: 'pooh', label: 'Winnie-the-Pooh', group: 'gentle', files: [G(67098)] },
  { id: 'andersen', label: "Andersen's Fairy Tales", group: 'gentle', files: [G(1597)] },
]

export const GROUPS = [
  { id: 'weird', label: 'Weird & Gothic' },
  { id: 'scifi', label: 'Science Fiction' },
  { id: 'classic', label: 'Ancient & Epic' },
  { id: 'novel', label: 'Novels' },
  { id: 'thought', label: 'Philosophy' },
  { id: 'gentle', label: 'Gentle' },
]

// The "common English" exclusion: every book in top100.
export const COMMON_ID = 'common'
export const COMMON_LABEL = 'common English'
