import { useState, useRef, useEffect, useLayoutEffect, useCallback, useMemo, lazy, Suspense } from 'react'
import { createPortal } from 'react-dom'
import './App.css'
import { StyleScopeList } from './StyleScopeDropdown'
// Lazy chunk — the ~40-component UI board only loads when the UI tab is opened
const UiPreview = lazy(() => import('./UiPreview'))
import fontAxesData from 'virtual:font-axes'
import logoGif from '/public/logo.gif'
import logoGifDark from '/public/logo_darkmode.gif'
import peerAvatar from '/public/peer-richelsen.png'
import calcomIcon from '/public/calcom-icon.svg'
import calcomBanner from '/public/calcom-banner.png'
import cossCalAvatar from '/public/coss-cal-avatar.jpg'
import cossUserAvatar from '/public/coss-user-avatar.jpg'

// ── Logo mode ─────────────────────────────────────────────────────────────────
// Set to true to show the client's SVG logo in the sidebar instead of the WM gif
const SHOW_CLIENT_LOGO = true

const _rawLogos = import.meta.glob('./logos/*.svg', { query: '?raw', import: 'default', eager: true })
const CLIENT_LOGOS = Object.fromEntries(
  Object.entries(_rawLogos).map(([path, svg]) => {
    const key = path.replace('./logos/', '').replace(/\.svg$/i, '').toLowerCase()
    const clean = svg
      .replace(/<\?xml[^?]*\?>\s*/i, '')       // strip XML declaration
      .replace(/<style[\s\S]*?<\/style>/gi, '') // strip embedded styles (prevent global bleed)
      .replace(/(<svg\b[^>]*?)(\s*fill="[^"]*")?(\s*>)/i, '$1 fill="currentColor"$3') // ensure currentColor
    return [key, clean]
  })
)
function fuzzyClientLogo(slug) {
  if (!slug) return null
  const n = slug.toLowerCase()
  if (CLIENT_LOGOS[n]) return CLIENT_LOGOS[n]
  const key = Object.keys(CLIENT_LOGOS).find(k => k.includes(n) || n.includes(k))
  return key ? CLIENT_LOGOS[key] : null
}
function ClientLogo({ slug, clientLabel }) {
  const svg = fuzzyClientLogo(slug)
  if (svg) return <div className="client-logo-svg" dangerouslySetInnerHTML={{ __html: svg }} />
  return <span className="client-logo-text">{clientLabel}</span>
}

// ── URL route parsing ────────────────────────────────────────────────────────
const BASE = '/font-proofer'
const SLUG_REDIRECTS = { calsansui: 'calsans', calsans2: 'calsans' }
function parseRoute() {
  const params = new URLSearchParams(window.location.search)
  const routeParam = params.get('route')
  if (routeParam) {
    window.history.replaceState(null, null, routeParam)
  }
  const path = window.location.pathname.startsWith(BASE)
    ? window.location.pathname.slice(BASE.length)
    : window.location.pathname
  const segments = path.split('/').filter(Boolean)
  let [clientSlug, fontSlug] = segments
  if (fontSlug && SLUG_REDIRECTS[fontSlug]) {
    fontSlug = SLUG_REDIRECTS[fontSlug]
    window.history.replaceState(null, null, `${BASE}/${clientSlug}/${fontSlug}${window.location.hash}`)
  }
  return { clientSlug: clientSlug || null, fontSlug: fontSlug || null }
}

function toDisplayName(slug) {
  return slug.split('-').map(w => w[0].toUpperCase() + w.slice(1)).join(' ')
}

// ── Hash ↔ mode mapping ───────────────────────────────────────────────────────
const HASH_TO_MODE = { '#big': 'big', '#paragraph': 'paragraph', '#glyphs': 'glyphs', '#type-scale': 'scale', '#calcom': 'calcom', '#coss': 'coss', '#ui': 'ui' }
const MODE_TO_HASH = { big: '#big', paragraph: '#paragraph', glyphs: '#glyphs', scale: '#type-scale', calcom: '#calcom', coss: '#coss', ui: '#ui' }

function resolveInitialMode(isCalcom) {
  const fromHash = HASH_TO_MODE[window.location.hash]
  if (fromHash === 'calcom' || fromHash === 'coss') return isCalcom ? fromHash : 'paragraph'
  return fromHash ?? 'paragraph'
}

// ── Font fuzzy matching ──────────────────────────────────────────────────────
const fontModules = import.meta.glob('/src/fonts/*.{ttf,otf,woff,woff2}', { eager: true, query: '?url', import: 'default' })

function normalize(s) {
  return s.toLowerCase().replace(/[-_\s]/g, '').replace(/var|demo|variable|display|text/g, '')
}

// ── Special built-in fonts (UI fonts, not from src/fonts/) ───────────────────
const SPECIAL_FONTS = {
  calsans: { name: 'CalSans', file: 'CalSansVF.ttf' },
  calsansflex: { name: 'CalSans Flex', file: 'CalSansFlexVF.ttf' },
  switzerland2038: { name: 'Switzerland 2038', file: 'Switzerland2038-500.ttf' },
  sbromievf: { name: 'SB Romie', file: 'SBRomieVF.ttf' },
}

function matchSpecial(slug) {
  return SPECIAL_FONTS[slug.toLowerCase().replace(/[-_\s]/g, '')] || null
}

function matchFont(slug) {
  const needle = normalize(slug)
  const entries = Object.entries(fontModules)
  if (!entries.length) return null
  const matches = entries.filter(([path]) => {
    const name = normalize(path.split('/').pop().replace(/\.[^.]+$/, ''))
    return name.includes(needle) || needle.includes(name)
  })
  const upright = matches.find(([path]) => !/italic|oblique/i.test(path))
  const match = upright ?? matches[0] ?? null
  return match ? { url: match[1], filename: match[0].split('/').pop() } : null
}

function matchItalicFont(slug) {
  const needle = normalize(slug)
  const entries = Object.entries(fontModules)
  const matches = entries.filter(([path]) => {
    const name = normalize(path.split('/').pop().replace(/\.[^.]+$/, ''))
    return name.includes(needle) || needle.includes(name)
  })
  const italic = matches.find(([path]) => /italic|oblique/i.test(path))
  return italic ? { url: italic[1], filename: italic[0].split('/').pop() } : null
}

// ── Static family style picker ───────────────────────────────────────────────
// A static family ships one file per weight×slant (e.g. SBRomie-BoldItalic.ttf).
// getFamilyStyles groups the slug-matching files by weight so the UI can offer a
// "Style" dropdown; each entry pairs a roman file with its italic companion.
const WEIGHT_ORDER = ['thin', 'extralight', 'ultralight', 'light', 'book', 'regular', 'normal', 'medium', 'semibold', 'demibold', 'bold', 'extrabold', 'heavy', 'black']

function parseWeightSlant(filename) {
  const base = filename.replace(/\.[^.]+$/, '')
  const italic = /italic|oblique/i.test(base)
  let weight = (base.split(/[-_ ]/).pop() || base).replace(/italic|oblique/gi, '').trim()
  if (!weight) weight = 'Regular'
  return { weight, italic }
}

function getFamilyStyles(slug) {
  const needle = normalize(slug)
  const entries = Object.entries(fontModules).filter(([path]) => {
    const n = normalize(path.split('/').pop().replace(/\.[^.]+$/, ''))
    return n.includes(needle) || needle.includes(n)
  })
  const byWeight = new Map()
  for (const [path, url] of entries) {
    const filename = path.split('/').pop()
    const { weight, italic } = parseWeightSlant(filename)
    const key = weight.toLowerCase()
    // Only recognized weight names count — this keeps variable fonts (Geist,
    // Kloten: filenames like "Geist[wght]") from being misread as a static family.
    if (!WEIGHT_ORDER.includes(key)) continue
    if (!byWeight.has(key)) byWeight.set(key, { key, label: weight, roman: null, italic: null })
    const slot = byWeight.get(key)
    if (italic) slot.italic = { url, filename }
    else slot.roman = { url, filename }
  }
  const rank = (k) => { const i = WEIGHT_ORDER.indexOf(k); return i === -1 ? 999 : i }
  return Array.from(byWeight.values()).sort((a, b) => rank(a.key) - rank(b.key))
}

function defaultStyleKey(styles) {
  return (styles.find(s => s.key === 'regular') ?? styles.find(s => s.key === 'normal' || s.key === 'book') ?? styles[Math.floor(styles.length / 2)])?.key ?? null
}

// ── Sample content ──────────────────────────────────────────────────────────
const SAMPLE_BIG = 'Hand gloves'

function makeBlocks(arr) {
  return arr.map((b, i) => ({ ...b, id: String(i + 1) }))
}

const TEXT_PRESETS = {
  'Sample': makeBlocks([
    { type: 'h1', text: 'Hand gloves' },
    { type: 'p',  text: 'Typography is the art and technique of arranging type to make written language legible, readable, and appealing when displayed. The arrangement of type involves selecting typefaces, point sizes, line lengths, line-spacing, and letter-spacing, as well as adjusting the space between pairs of letters.' },
    { type: 'p',  text: 'The term typography is also applied to the style, arrangement, and appearance of the letters, numbers, and symbols created by the process. Type design is a closely related craft, sometimes considered part of typography.' },
  ]),
  'A Tale of Two Cities': makeBlocks([
    { type: 'h1', text: 'A Tale of Two Cities' },
    { type: 'h2', text: 'Chapter I — The Period' },
    { type: 'p',  text: 'It was the best of times, it was the worst of times, it was the age of wisdom, it was the age of foolishness, it was the epoch of belief, it was the epoch of incredulity, it was the season of Light, it was the season of Darkness, it was the spring of hope, it was the winter of despair, we had everything before us, we had nothing before us, we were all going direct to Heaven, we were all going direct the other way—in short, the period was so far like the present period, that some of its noisiest authorities insisted on its being received, for good or for evil, in the superlative degree of comparison only.' },
    { type: 'p',  text: 'There were a king with a large jaw and a queen with a plain face, on the throne of England; there were a king with a large jaw and a queen with a fair face, on the throne of France. In both countries it was clearer than crystal to the lords of the State preserves of loaves and fishes, that things in general were settled for ever.' },
    { type: 'p',  text: 'It was the year of Our Lord one thousand seven hundred and seventy-five. Spiritual revelations were conceded to England at that favoured period, as at this. Mrs. Southcott had recently attained her five-and-twentieth blessed birthday, of whom a prophetic private in the Life Guards had heralded the sublime appearance by announcing that arrangements were made for the swallowing up of London and Westminster. Even the Cock-lane ghost had been laid only a round dozen of years, after rapping out its messages, as the spirits of this very year last past (supernaturally deficient in originality) rapped out theirs. Mere messages in the earthly order of events had lately come to the English Crown and People, from a congress of British subjects in America: which, strange to relate, have proved more important to the human race than any communications yet received through any of the chickens of the Cock-lane brood.' },
    { type: 'p',  text: 'France, less favoured on the whole as to matters spiritual than her sister of the shield and trident, rolled with exceeding smoothness down hill, making paper money and spending it. Under the guidance of her Christian pastors, she entertained herself, besides, with such humane achievements as sentencing a youth to have his hands cut off, his tongue torn out with pincers, and his body burned alive, because he had not kneeled down in the rain to do honour to a dirty procession of monks which passed within his view, at a distance of some fifty or sixty yards. It is likely enough that, rooted in the woods of France and Norway, there were growing trees, when that sufferer was put to death, already marked by the Woodman, Fate, to come down and be sawn into boards, to make a certain movable framework with a sack and a knife in it, terrible in history. It is likely enough that in the rough outhouses of some tillers of the heavy lands adjacent to Paris, there were sheltered from the weather that very day, rude carts, bespattered with rustic mire, snuffed about by pigs, and roosted in by poultry, which the Farmer, Death, had already set apart to be his tumbrils of the Revolution. But that Woodman and that Farmer, though they work unceasingly, work silently, and no one heard them as they went about with muffled tread: the rather, forasmuch as to entertain any suspicion that they were awake, was to be atheistical and traitorous.' },
    { type: 'p',  text: 'In England, there was scarcely an amount of order and protection to justify much national boasting. Daring burglaries by armed men, and highway robberies, took place in the capital itself every night; families were publicly cautioned not to go out of town without removing their furniture to upholsterers’ warehouses for security; the highwayman in the dark was a City tradesman in the light, and, being recognised and challenged by his fellow-tradesman whom he stopped in his character of “the Captain,” gallantly shot him through the head and rode away; the mail was waylaid by seven robbers, and the guard shot three dead, and then got shot dead himself by the other four, “in consequence of the failure of his ammunition:” after which the mail was robbed in peace; that magnificent potentate, the Lord Mayor of London, was made to stand and deliver on Turnham Green, by one highwayman, who despoiled the illustrious creature in sight of all his retinue; prisoners in London gaols fought battles with their turnkeys, and the majesty of the law fired blunderbusses in among them, loaded with rounds of shot and ball; thieves snipped off diamond crosses from the necks of noble lords at Court drawing-rooms; musketeers went into St. Giles’s, to search for contraband goods, and the mob fired on the musketeers, and the musketeers fired on the mob, and nobody thought any of these occurrences much out of the common way. In the midst of them, the hangman, ever busy and ever worse than useless, was in constant requisition; now, stringing up long rows of miscellaneous criminals; now, hanging a housebreaker on Saturday who had been taken on Tuesday; now, burning people in the hand at Newgate by the dozen, and now burning pamphlets at the door of Westminster Hall; to-day, taking the life of an atrocious murderer, and to-morrow of a wretched pilferer who had robbed a farmer’s boy of sixpence.' },
    { type: 'p',  text: 'All these things, and a thousand like them, came to pass in and close upon the dear old year one thousand seven hundred and seventy-five. Environed by them, while the Woodman and the Farmer worked unheeded, those two of the large jaws, and those other two of the plain and the fair faces, trod with stir enough, and carried their divine rights with a high hand. Thus did the year one thousand seven hundred and seventy-five conduct their Greatnesses, and myriads of small creatures—the creatures of this chronicle among the rest—along the roads that lay before them.' },
    { type: 'h2', text: 'Chapter II — The Mail' },
    { type: 'p',  text: 'It was the Dover road that lay, on a Friday night late in November, before the first of the persons with whom this history has business. The Dover road lay, as to him, beyond the Dover mail, as it lumbered up Shooter’s Hill. He walked up hill in the mire by the side of the mail, as the rest of the passengers did; not because they had the least relish for walking exercise, under the circumstances, but because the hill, and the harness, and the mud, and the mail, were all so heavy, that the horses had three times already come to a stop, besides once drawing the coach across the road, with the mutinous intent of taking it back to Blackheath. Reins and whip and coachman and guard, however, in combination, had read that article of war which forbade a purpose otherwise strongly in favour of the argument, that some brute animals are endued with Reason; and the team had capitulated and returned to their duty.' },
    { type: 'p',  text: 'With drooping heads and tremulous tails, they mashed their way through the thick mud, floundering and stumbling between whiles, as if they were falling to pieces at the larger joints. As often as the driver rested them and brought them to a stand, with a wary “Wo-ho! so-ho-then!” the near leader violently shook his head and everything upon it—like an unusually emphatic horse, denying that the coach could be got up the hill. Whenever the leader made this rattle, the passenger started, as a nervous passenger might, and was disturbed in mind.' },
    { type: 'p',  text: 'There was a steaming mist in all the hollows, and it had roamed in its forlornness up the hill, like an evil spirit, seeking rest and finding none. A clammy and intensely cold mist, it made its slow way through the air in ripples that visibly followed and overspread one another, as the waves of an unwholesome sea might do. It was dense enough to shut out everything from the light of the coach-lamps but these its own workings, and a few yards of road; and the reek of the labouring horses steamed into it, as if they had made it all.' },
    { type: 'p',  text: 'Two other passengers, besides the one, were plodding up the hill by the side of the mail. All three were wrapped to the cheekbones and over the ears, and wore jack-boots. Not one of the three could have said, from anything he saw, what either of the other two was like; and each was hidden under almost as many wrappers from the eyes of the mind, as from the eyes of the body, of his two companions. In those days, travellers were very shy of being confidential on a short notice, for anybody on the road might be a robber or in league with robbers. As to the latter, when every posting-house and ale-house could produce somebody in “the Captain’s” pay, ranging from the landlord to the lowest stable non-descript, it was the likeliest thing upon the cards. So the guard of the Dover mail thought to himself, that Friday night in November, one thousand seven hundred and seventy-five, lumbering up Shooter’s Hill, as he stood on his own particular perch behind the mail, beating his feet, and keeping an eye and a hand on the arm-chest before him, where a loaded blunderbuss lay at the top of six or eight loaded horse-pistols, deposited on a substratum of cutlass.' },
    { type: 'p',  text: 'The Dover mail was in its usual genial position that the guard suspected the passengers, the passengers suspected one another and the guard, they all suspected everybody else, and the coachman was sure of nothing but the horses; as to which cattle he could with a clear conscience have taken his oath on the two Testaments that they were not fit for the journey.' },
    { type: 'p',  text: '“Wo-ho!” said the coachman. “So, then! One more pull and you’re at the top and be damned to you, for I have had trouble enough to get you to it!—Joe!”' },
    { type: 'p',  text: '“Halloa!” the guard replied.' },
    { type: 'p',  text: '“What o’clock do you make it, Joe?”' },
    { type: 'p',  text: '“Ten minutes, good, past eleven.”' },
    { type: 'p',  text: '“My blood!” ejaculated the vexed coachman, “and not atop of Shooter’s yet! Tst! Yah! Get on with you!”' },
    { type: 'p',  text: 'The emphatic horse, cut short by the whip in a most decided negative, made a decided scramble for it, and the three other horses followed suit. Once more, the Dover mail struggled on, with the jack-boots of its passengers squashing along by its side. They had stopped when the coach stopped, and they kept close company with it. If any one of the three had had the hardihood to propose to another to walk on a little ahead into the mist and darkness, he would have put himself in a fair way of getting shot instantly as a highwayman.' },
    { type: 'p',  text: 'The last burst carried the mail to the summit of the hill. The horses stopped to breathe again, and the guard got down to skid the wheel for the descent, and open the coach-door to let the passengers in.' },
    { type: 'p',  text: '“Tst! Joe!” cried the coachman in a warning voice, looking down from his box.' },
    { type: 'p',  text: '“What do you say, Tom?”' },
    { type: 'p',  text: 'They both listened.' },
    { type: 'p',  text: '“I say a horse at a canter coming up, Joe.”' },
    { type: 'p',  text: '“*I* say a horse at a gallop, Tom,” returned the guard, leaving his hold of the door, and mounting nimbly to his place. “Gentlemen! In the king’s name, all of you!”' },
    { type: 'p',  text: 'With this hurried adjuration, he cocked his blunderbuss, and stood on the offensive.' },
    { type: 'p',  text: 'The passenger booked by this history, was on the coach-step, getting in; the two other passengers were close behind him, and about to follow. He remained on the step, half in the coach and half out of; they remained in the road below him. They all looked from the coachman to the guard, and from the guard to the coachman, and listened. The coachman looked back and the guard looked back, and even the emphatic leader pricked up his ears and looked back, without contradicting.' },
    { type: 'p',  text: 'The stillness consequent on the cessation of the rumbling and labouring of the coach, added to the stillness of the night, made it very quiet indeed. The panting of the horses communicated a tremulous motion to the coach, as if it were in a state of agitation. The hearts of the passengers beat loud enough perhaps to be heard; but at any rate, the quiet pause was audibly expressive of people out of breath, and holding the breath, and having the pulses quickened by expectation.' },
    { type: 'p',  text: 'The sound of a horse at a gallop came fast and furiously up the hill.' },
    { type: 'p',  text: '“So-ho!” the guard sang out, as loud as he could roar. “Yo there! Stand! I shall fire!”' },
    { type: 'p',  text: 'The pace was suddenly checked, and, with much splashing and floundering, a man’s voice called from the mist, “Is that the Dover mail?”' },
    { type: 'p',  text: '“Never you mind what it is!” the guard retorted. “What are you?”' },
    { type: 'p',  text: '“*Is* that the Dover mail?”' },
    { type: 'p',  text: '“Why do you want to know?”' },
    { type: 'p',  text: '“I want a passenger, if it is.”' },
    { type: 'p',  text: '“What passenger?”' },
    { type: 'p',  text: '“Mr. Jarvis Lorry.”' },
    { type: 'p',  text: 'Our booked passenger showed in a moment that it was his name. The guard, the coachman, and the two other passengers eyed him distrustfully.' },
    { type: 'p',  text: '“Keep where you are,” the guard called to the voice in the mist, “because, if I should make a mistake, it could never be set right in your lifetime. Gentleman of the name of Lorry answer straight.”' },
    { type: 'p',  text: '“What is the matter?” asked the passenger, then, with mildly quavering speech. “Who wants me? Is it Jerry?”' },
    { type: 'p',  text: '(“I don’t like Jerry’s voice, if it is Jerry,” growled the guard to himself. “He’s hoarser than suits me, is Jerry.”)' },
    { type: 'p',  text: '“Yes, Mr. Lorry.”' },
    { type: 'p',  text: '“What is the matter?”' },
    { type: 'p',  text: '“A despatch sent after you from over yonder. T. and Co.”' },
    { type: 'p',  text: '“I know this messenger, guard,” said Mr. Lorry, getting down into the road—assisted from behind more swiftly than politely by the other two passengers, who immediately scrambled into the coach, shut the door, and pulled up the window. “He may come close; there’s nothing wrong.”' },
    { type: 'p',  text: '“I hope there ain’t, but I can’t make so ’Nation sure of that,” said the guard, in gruff soliloquy. “Hallo you!”' },
    { type: 'p',  text: '“Well! And hallo you!” said Jerry, more hoarsely than before.' },
    { type: 'p',  text: '“Come on at a footpace! d’ye mind me? And if you’ve got holsters to that saddle o’ yourn, don’t let me see your hand go nigh ’em. For I’m a devil at a quick mistake, and when I make one it takes the form of Lead. So now let’s look at you.”' },
    { type: 'p',  text: 'The figures of a horse and rider came slowly through the eddying mist, and came to the side of the mail, where the passenger stood. The rider stooped, and, casting up his eyes at the guard, handed the passenger a small folded paper. The rider’s horse was blown, and both horse and rider were covered with mud, from the hoofs of the horse to the hat of the man.' },
    { type: 'p',  text: '“Guard!” said the passenger, in a tone of quiet business confidence.' },
    { type: 'p',  text: 'The watchful guard, with his right hand at the stock of his raised blunderbuss, his left at the barrel, and his eye on the horseman, answered curtly, “Sir.”' },
    { type: 'p',  text: '“There is nothing to apprehend. I belong to Tellson’s Bank. You must know Tellson’s Bank in London. I am going to Paris on business. A crown to drink. I may read this?”' },
    { type: 'p',  text: '“If so be as you’re quick, sir.”' },
    { type: 'p',  text: 'He opened it in the light of the coach-lamp on that side, and read—first to himself and then aloud: “‘Wait at Dover for Mam’selle.’ It’s not long, you see, guard. Jerry, say that my answer was, *Recalled to life*.”' },
    { type: 'p',  text: 'Jerry started in his saddle. “That’s a Blazing strange answer, too,” said he, at his hoarsest.' },
    { type: 'p',  text: '“Take that message back, and they will know that I received this, as well as if I wrote. Make the best of your way. Good night.”' },
    { type: 'p',  text: 'With those words the passenger opened the coach-door and got in; not at all assisted by his fellow-passengers, who had expeditiously secreted their watches and purses in their boots, and were now making a general pretence of being asleep. With no more definite purpose than to escape the hazard of originating any other kind of action.' },
    { type: 'p',  text: 'The coach lumbered on again, with heavier wreaths of mist closing round it as it began the descent. The guard soon replaced his blunderbuss in his arm-chest, and, having looked to the rest of its contents, and having looked to the supplementary pistols that he wore in his belt, looked to a smaller chest beneath his seat, in which there were a few smith’s tools, a couple of torches, and a tinder-box. For he was furnished with that completeness that if the coach-lamps had been blown and stormed out, which did occasionally happen, he had only to shut himself up inside, keep the flint and steel sparks well off the straw, and get a light with tolerable safety and ease (if he were lucky) in five minutes.' },
    { type: 'p',  text: '“Tom!” softly over the coach roof.' },
    { type: 'p',  text: '“Hallo, Joe.”' },
    { type: 'p',  text: '“Did you hear the message?”' },
    { type: 'p',  text: '“I did, Joe.”' },
    { type: 'p',  text: '“What did you make of it, Tom?”' },
    { type: 'p',  text: '“Nothing at all, Joe.”' },
    { type: 'p',  text: '“That’s a coincidence, too,” the guard mused, “for I made the same of it myself.”' },
    { type: 'p',  text: 'Jerry, left alone in the mist and darkness, dismounted meanwhile, not only to ease his spent horse, but to wipe the mud from his face, and shake the wet out of his hat-brim, which might be capable of holding about half a gallon. After standing with the bridle over his heavily-splashed arm, until the wheels of the mail were no longer within hearing and the night was quite still again, he turned to walk down the hill.' },
    { type: 'p',  text: '“After that there gallop from Temple Bar, old lady, I won’t trust your fore-legs till I get you on the level,” said this hoarse messenger, glancing at his mare. “‘Recalled to life.’ That’s a Blazing strange message. Much of that wouldn’t do for you, Jerry! I say, Jerry! You’d be in a Blazing bad way, if recalling to life was to come into fashion, Jerry!”' },
    { type: 'h2', text: 'Chapter III — The Night Shadows' },
    { type: 'p',  text: 'A wonderful fact to reflect upon, that every human creature is constituted to be that profound secret and mystery to every other. A solemn consideration, when I enter a great city by night, that every one of those darkly clustered houses encloses its own secret; that every room in every one of them encloses its own secret; that every beating heart in the hundreds of thousands of breasts there, is, in some of its imaginings, a secret to the heart nearest it! Something of the awfulness, even of Death itself, is referable to this. No more can I turn the leaves of this dear book that I loved, and vainly hope in time to read it all. No more can I look into the depths of this unfathomable water, wherein, as momentary lights glanced into it, I have had glimpses of buried treasure and other things submerged. It was appointed that the book should shut with a spring, for ever and for ever, when I had read but a page. It was appointed that the water should be locked in an eternal frost, when the light was playing on its surface, and I stood in ignorance on the shore. My friend is dead, my neighbour is dead, my love, the darling of my soul, is dead; it is the inexorable consolidation and perpetuation of the secret that was always in that individuality, and which I shall carry in mine to my life’s end. In any of the burial-places of this city through which I pass, is there a sleeper more inscrutable than its busy inhabitants are, in their innermost personality, to me, or than I am to them?' },
    { type: 'p',  text: 'As to this, his natural and not to be alienated inheritance, the messenger on horseback had exactly the same possessions as the King, the first Minister of State, or the richest merchant in London. So with the three passengers shut up in the narrow compass of one lumbering old mail coach; they were mysteries to one another, as complete as if each had been in his own coach and six, or his own coach and sixty, with the breadth of a county between him and the next.' },
    { type: 'p',  text: 'The messenger rode back at an easy trot, stopping pretty often at ale-houses by the way to drink, but evincing a tendency to keep his own counsel, and to keep his hat cocked over his eyes. He had eyes that assorted very well with that decoration, being of a surface black, with no depth in the colour or form, and much too near together—as if they were afraid of being found out in something, singly, if they kept too far apart. They had a sinister expression, under an old cocked-hat like a three-cornered spittoon, and over a great muffler for the chin and throat, which descended nearly to the wearer’s knees. When he stopped for drink, he moved this muffler with his left hand, only while he poured his liquor in with his right; as soon as that was done, he muffled again.' },
    { type: 'p',  text: '“No, Jerry, no!” said the messenger, harping on one theme as he rode. “It wouldn’t do for you, Jerry. Jerry, you honest tradesman, it wouldn’t suit *your* line of business! Recalled—! Bust me if I don’t think he’d been a drinking!”' },
    { type: 'p',  text: 'His message perplexed his mind to that degree that he was fain, several times, to take off his hat to scratch his head. Except on the crown, which was raggedly bald, he had stiff, black hair, standing jaggedly all over it, and growing down hill almost to his broad, blunt nose. It was so like Smith’s work, so much more like the top of a strongly spiked wall than a head of hair, that the best of players at leap-frog might have declined him, as the most dangerous man in the world to go over.' },
    { type: 'p',  text: 'While he trotted back with the message he was to deliver to the night watchman in his box at the door of Tellson’s Bank, by Temple Bar, who was to deliver it to greater authorities within, the shadows of the night took such shapes to him as arose out of the message, and took such shapes to the mare as arose out of *her* private topics of uneasiness. They seemed to be numerous, for she shied at every shadow on the road.' },
    { type: 'p',  text: 'What time, the mail-coach lumbered, jolted, rattled, and bumped upon its tedious way, with its three fellow-inscrutables inside. To whom, likewise, the shadows of the night revealed themselves, in the forms their dozing eyes and wandering thoughts suggested.' },
    { type: 'p',  text: 'Tellson’s Bank had a run upon it in the mail. As the bank passenger—with an arm drawn through the leathern strap, which did what lay in it to keep him from pounding against the next passenger, and driving him into his corner, whenever the coach got a special jolt—nodded in his place, with half-shut eyes, the little coach-windows, and the coach-lamp dimly gleaming through them, and the bulky bundle of opposite passenger, became the bank, and did a great stroke of business. The rattle of the harness was the chink of money, and more drafts were honoured in five minutes than even Tellson’s, with all its foreign and home connection, ever paid in thrice the time. Then the strong-rooms underground, at Tellson’s, with such of their valuable stores and secrets as were known to the passenger (and it was not a little that he knew about them), opened before him, and he went in among them with the great keys and the feebly-burning candle, and found them safe, and strong, and sound, and still, just as he had last seen them.' },
    { type: 'p',  text: 'But, though the bank was almost always with him, and though the coach (in a confused way, like the presence of pain under an opiate) was always with him, there was another current of impression that never ceased to run, all through the night. He was on his way to dig some one out of a grave.' },
    { type: 'p',  text: 'Now, which of the multitude of faces that showed themselves before him was the true face of the buried person, the shadows of the night did not indicate; but they were all the faces of a man of five-and-forty by years, and they differed principally in the passions they expressed, and in the ghastliness of their worn and wasted state. Pride, contempt, defiance, stubbornness, submission, lamentation, succeeded one another; so did varieties of sunken cheek, cadaverous colour, emaciated hands and figures. But the face was in the main one face, and every head was prematurely white. A hundred times the dozing passenger inquired of this spectre:' },
    { type: 'p',  text: '“Buried how long?”' },
    { type: 'p',  text: 'The answer was always the same: “Almost eighteen years.”' },
    { type: 'p',  text: '“You had abandoned all hope of being dug out?”' },
    { type: 'p',  text: '“Long ago.”' },
    { type: 'p',  text: '“You know that you are recalled to life?”' },
    { type: 'p',  text: '“They tell me so.”' },
    { type: 'p',  text: '“I hope you care to live?”' },
    { type: 'p',  text: '“I can’t say.”' },
    { type: 'p',  text: '“Shall I show her to you? Will you come and see her?”' },
    { type: 'p',  text: 'The answers to this question were various and contradictory. Sometimes the broken reply was, “Wait! It would kill me if I saw her too soon.” Sometimes, it was given in a tender rain of tears, and then it was, “Take me to her.” Sometimes it was staring and bewildered, and then it was, “I don’t know her. I don’t understand.”' },
    { type: 'p',  text: 'After such imaginary discourse, the passenger in his fancy would dig, and dig, dig—now with a spade, now with a great key, now with his hands—to dig this wretched creature out. Got out at last, with earth hanging about his face and hair, he would suddenly fan away to dust. The passenger would then start to himself, and lower the window, to get the reality of mist and rain on his cheek.' },
    { type: 'p',  text: 'Yet even when his eyes were opened on the mist and rain, on the moving patch of light from the lamps, and the hedge at the roadside retreating by jerks, the night shadows outside the coach would fall into the train of the night shadows within. The real Banking-house by Temple Bar, the real business of the past day, the real strong rooms, the real express sent after him, and the real message returned, would all be there. Out of the midst of them, the ghostly face would rise, and he would accost it again.' },
    { type: 'p',  text: '“Buried how long?”' },
    { type: 'p',  text: '“Almost eighteen years.”' },
    { type: 'p',  text: '“I hope you care to live?”' },
    { type: 'p',  text: '“I can’t say.”' },
    { type: 'p',  text: 'Dig—dig—dig—until an impatient movement from one of the two passengers would admonish him to pull up the window, draw his arm securely through the leathern strap, and speculate upon the two slumbering forms, until his mind lost its hold of them, and they again slid away into the bank and the grave.' },
    { type: 'p',  text: '“Buried how long?”' },
    { type: 'p',  text: '“Almost eighteen years.”' },
    { type: 'p',  text: '“You had abandoned all hope of being dug out?”' },
    { type: 'p',  text: '“Long ago.”' },
    { type: 'p',  text: 'The words were still in his hearing as just spoken—distinctly in his hearing as ever spoken words had been in his life—when the weary passenger started to the consciousness of daylight, and found that the shadows of the night were gone.' },
    { type: 'p',  text: 'He lowered the window, and looked out at the rising sun. There was a ridge of ploughed land, with a plough upon it where it had been left last night when the horses were unyoked; beyond, a quiet coppice-wood, in which many leaves of burning red and golden yellow still remained upon the trees. Though the earth was cold and wet, the sky was clear, and the sun rose bright, placid, and beautiful.' },
    { type: 'p',  text: '“Eighteen years!” said the passenger, looking at the sun. “Gracious Creator of day! To be buried alive for eighteen years!”' },
    { type: 'h2', text: 'Chapter IV — The Preparation' },
    { type: 'p',  text: 'When the mail got successfully to Dover, in the course of the forenoon, the head drawer at the Royal George Hotel opened the coach-door as his custom was. He did it with some flourish of ceremony, for a mail journey from London in winter was an achievement to congratulate an adventurous traveller upon.' },
    { type: 'p',  text: 'By that time, there was only one adventurous traveller left be congratulated: for the two others had been set down at their respective roadside destinations. The mildewy inside of the coach, with its damp and dirty straw, its disagreeable smell, and its obscurity, was rather like a larger dog-kennel. Mr. Lorry, the passenger, shaking himself out of it in chains of straw, a tangle of shaggy wrapper, flapping hat, and muddy legs, was rather like a larger sort of dog.' },
    { type: 'p',  text: '“There will be a packet to Calais, tomorrow, drawer?”' },
    { type: 'p',  text: '“Yes, sir, if the weather holds and the wind sets tolerable fair. The tide will serve pretty nicely at about two in the afternoon, sir. Bed, sir?”' },
    { type: 'p',  text: '“I shall not go to bed till night; but I want a bedroom, and a barber.”' },
    { type: 'p',  text: '“And then breakfast, sir? Yes, sir. That way, sir, if you please. Show Concord! Gentleman’s valise and hot water to Concord. Pull off gentleman’s boots in Concord. (You will find a fine sea-coal fire, sir.) Fetch barber to Concord. Stir about there, now, for Concord!”' },
    { type: 'p',  text: 'The Concord bed-chamber being always assigned to a passenger by the mail, and passengers by the mail being always heavily wrapped up from head to foot, the room had the odd interest for the establishment of the Royal George, that although but one kind of man was seen to go into it, all kinds and varieties of men came out of it. Consequently, another drawer, and two porters, and several maids and the landlady, were all loitering by accident at various points of the road between the Concord and the coffee-room, when a gentleman of sixty, formally dressed in a brown suit of clothes, pretty well worn, but very well kept, with large square cuffs and large flaps to the pockets, passed along on his way to his breakfast.' },
    { type: 'p',  text: 'The coffee-room had no other occupant, that forenoon, than the gentleman in brown. His breakfast-table was drawn before the fire, and as he sat, with its light shining on him, waiting for the meal, he sat so still, that he might have been sitting for his portrait.' },
    { type: 'p',  text: 'Very orderly and methodical he looked, with a hand on each knee, and a loud watch ticking a sonorous sermon under his flapped waist-coat, as though it pitted its gravity and longevity against the levity and evanescence of the brisk fire. He had a good leg, and was a little vain of it, for his brown stockings fitted sleek and close, and were of a fine texture; his shoes and buckles, too, though plain, were trim. He wore an odd little sleek crisp flaxen wig, setting very close to his head: which wig, it is to be presumed, was made of hair, but which looked far more as though it were spun from filaments of silk or glass. His linen, though not of a fineness in accordance with his stockings, was as white as the tops of the waves that broke upon the neighbouring beach, or the specks of sail that glinted in the sunlight far at sea. A face habitually suppressed and quieted, was still lighted up under the quaint wig by a pair of moist bright eyes that it must have cost their owner, in years gone by, some pains to drill to the composed and reserved expression of Tellson’s Bank. He had a healthy colour in his cheeks, and his face, though lined, bore few traces of anxiety. But, perhaps the confidential bachelor clerks in Tellson’s Bank were principally occupied with the cares of other people; and perhaps second-hand cares, like second-hand clothes, come easily off and on.' },
    { type: 'p',  text: 'Completing his resemblance to a man who was sitting for his portrait, Mr. Lorry dropped off to sleep. The arrival of his breakfast roused him, and he said to the drawer, as he moved his chair to it:' },
    { type: 'p',  text: '“I wish accommodation prepared for a young lady who may come here at any time to-day. She may ask for Mr. Jarvis Lorry, or she may only ask for a gentleman from Tellson’s Bank. Please to let me know.”' },
    { type: 'p',  text: '“Yes, sir. Tellson’s Bank in London, sir?”' },
    { type: 'p',  text: '“Yes.”' },
    { type: 'p',  text: '“Yes, sir. We have oftentimes the honour to entertain your gentlemen in their travelling backwards and forwards betwixt London and Paris, sir. A vast deal of travelling, sir, in Tellson and Company’s House.”' },
    { type: 'p',  text: '“Yes. We are quite a French House, as well as an English one.”' },
    { type: 'p',  text: '“Yes, sir. Not much in the habit of such travelling yourself, I think, sir?”' },
    { type: 'p',  text: '“Not of late years. It is fifteen years since we—since I—came last from France.”' },
    { type: 'p',  text: '“Indeed, sir? That was before my time here, sir. Before our people’s time here, sir. The George was in other hands at that time, sir.”' },
    { type: 'p',  text: '“I believe so.”' },
    { type: 'p',  text: '“But I would hold a pretty wager, sir, that a House like Tellson and Company was flourishing, a matter of fifty, not to speak of fifteen years ago?”' },
    { type: 'p',  text: '“You might treble that, and say a hundred and fifty, yet not be far from the truth.”' },
    { type: 'p',  text: '“Indeed, sir!”' },
    { type: 'p',  text: 'Rounding his mouth and both his eyes, as he stepped backward from the table, the waiter shifted his napkin from his right arm to his left, dropped into a comfortable attitude, and stood surveying the guest while he ate and drank, as from an observatory or watchtower. According to the immemorial usage of waiters in all ages.' },
    { type: 'p',  text: 'When Mr. Lorry had finished his breakfast, he went out for a stroll on the beach. The little narrow, crooked town of Dover hid itself away from the beach, and ran its head into the chalk cliffs, like a marine ostrich. The beach was a desert of heaps of sea and stones tumbling wildly about, and the sea did what it liked, and what it liked was destruction. It thundered at the town, and thundered at the cliffs, and brought the coast down, madly. The air among the houses was of so strong a piscatory flavour that one might have supposed sick fish went up to be dipped in it, as sick people went down to be dipped in the sea. A little fishing was done in the port, and a quantity of strolling about by night, and looking seaward: particularly at those times when the tide made, and was near flood. Small tradesmen, who did no business whatever, sometimes unaccountably realised large fortunes, and it was remarkable that nobody in the neighbourhood could endure a lamplighter.' },
    { type: 'p',  text: 'As the day declined into the afternoon, and the air, which had been at intervals clear enough to allow the French coast to be seen, became again charged with mist and vapour, Mr. Lorry’s thoughts seemed to cloud too. When it was dark, and he sat before the coffee-room fire, awaiting his dinner as he had awaited his breakfast, his mind was busily digging, digging, digging, in the live red coals.' },
    { type: 'p',  text: 'A bottle of good claret after dinner does a digger in the red coals no harm, otherwise than as it has a tendency to throw him out of work. Mr. Lorry had been idle a long time, and had just poured out his last glassful of wine with as complete an appearance of satisfaction as is ever to be found in an elderly gentleman of a fresh complexion who has got to the end of a bottle, when a rattling of wheels came up the narrow street, and rumbled into the inn-yard.' },
    { type: 'p',  text: 'He set down his glass untouched. “This is Mam’selle!” said he.' },
    { type: 'p',  text: 'In a very few minutes the waiter came in to announce that Miss Manette had arrived from London, and would be happy to see the gentleman from Tellson’s.' },
    { type: 'p',  text: '“So soon?”' },
    { type: 'p',  text: 'Miss Manette had taken some refreshment on the road, and required none then, and was extremely anxious to see the gentleman from Tellson’s immediately, if it suited his pleasure and convenience.' },
    { type: 'p',  text: 'The gentleman from Tellson’s had nothing left for it but to empty his glass with an air of stolid desperation, settle his odd little flaxen wig at the ears, and follow the waiter to Miss Manette’s apartment. It was a large, dark room, furnished in a funereal manner with black horsehair, and loaded with heavy dark tables. These had been oiled and oiled, until the two tall candles on the table in the middle of the room were gloomily reflected on every leaf; as if *they* were buried, in deep graves of black mahogany, and no light to speak of could be expected from them until they were dug out.' },
    { type: 'p',  text: 'The obscurity was so difficult to penetrate that Mr. Lorry, picking his way over the well-worn Turkey carpet, supposed Miss Manette to be, for the moment, in some adjacent room, until, having got past the two tall candles, he saw standing to receive him by the table between them and the fire, a young lady of not more than seventeen, in a riding-cloak, and still holding her straw travelling-hat by its ribbon in her hand. As his eyes rested on a short, slight, pretty figure, a quantity of golden hair, a pair of blue eyes that met his own with an inquiring look, and a forehead with a singular capacity (remembering how young and smooth it was), of rifting and knitting itself into an expression that was not quite one of perplexity, or wonder, or alarm, or merely of a bright fixed attention, though it included all the four expressions—as his eyes rested on these things, a sudden vivid likeness passed before him, of a child whom he had held in his arms on the passage across that very Channel, one cold time, when the hail drifted heavily and the sea ran high. The likeness passed away, like a breath along the surface of the gaunt pier-glass behind her, on the frame of which, a hospital procession of negro cupids, several headless and all cripples, were offering black baskets of Dead Sea fruit to black divinities of the feminine gender—and he made his formal bow to Miss Manette.' },
    { type: 'p',  text: '“Pray take a seat, sir.” In a very clear and pleasant young voice; a little foreign in its accent, but a very little indeed.' },
    { type: 'p',  text: '“I kiss your hand, miss,” said Mr. Lorry, with the manners of an earlier date, as he made his formal bow again, and took his seat.' },
    { type: 'p',  text: '“I received a letter from the Bank, sir, yesterday, informing me that some intelligence—or discovery—”' },
    { type: 'p',  text: '“The word is not material, miss; either word will do.”' },
    { type: 'p',  text: '“—respecting the small property of my poor father, whom I never saw—so long dead—”' },
    { type: 'p',  text: 'Mr. Lorry moved in his chair, and cast a troubled look towards the hospital procession of negro cupids. As if *they* had any help for anybody in their absurd baskets!' },
    { type: 'p',  text: '“—rendered it necessary that I should go to Paris, there to communicate with a gentleman of the Bank, so good as to be despatched to Paris for the purpose.”' },
    { type: 'p',  text: '“Myself.”' },
    { type: 'p',  text: '“As I was prepared to hear, sir.”' },
    { type: 'p',  text: 'She curtseyed to him (young ladies made curtseys in those days), with a pretty desire to convey to him that she felt how much older and wiser he was than she. He made her another bow.' },
    { type: 'p',  text: '“I replied to the Bank, sir, that as it was considered necessary, by those who know, and who are so kind as to advise me, that I should go to France, and that as I am an orphan and have no friend who could go with me, I should esteem it highly if I might be permitted to place myself, during the journey, under that worthy gentleman’s protection. The gentleman had left London, but I think a messenger was sent after him to beg the favour of his waiting for me here.”' },
    { type: 'p',  text: '“I was happy,” said Mr. Lorry, “to be entrusted with the charge. I shall be more happy to execute it.”' },
    { type: 'p',  text: '“Sir, I thank you indeed. I thank you very gratefully. It was told me by the Bank that the gentleman would explain to me the details of the business, and that I must prepare myself to find them of a surprising nature. I have done my best to prepare myself, and I naturally have a strong and eager interest to know what they are.”' },
    { type: 'p',  text: '“Naturally,” said Mr. Lorry. “Yes—I—”' },
    { type: 'p',  text: 'After a pause, he added, again settling the crisp flaxen wig at the ears, “It is very difficult to begin.”' },
    { type: 'p',  text: 'He did not begin, but, in his indecision, met her glance. The young forehead lifted itself into that singular expression—but it was pretty and characteristic, besides being singular—and she raised her hand, as if with an involuntary action she caught at, or stayed some passing shadow.' },
    { type: 'p',  text: '“Are you quite a stranger to me, sir?”' },
    { type: 'p',  text: '“Am I not?” Mr. Lorry opened his hands, and extended them outwards with an argumentative smile.' },
    { type: 'p',  text: 'Between the eyebrows and just over the little feminine nose, the line of which was as delicate and fine as it was possible to be, the expression deepened itself as she took her seat thoughtfully in the chair by which she had hitherto remained standing. He watched her as she mused, and the moment she raised her eyes again, went on:' },
    { type: 'p',  text: '“In your adopted country, I presume, I cannot do better than address you as a young English lady, Miss Manette?”' },
    { type: 'p',  text: '“If you please, sir.”' },
    { type: 'p',  text: '“Miss Manette, I am a man of business. I have a business charge to acquit myself of. In your reception of it, don’t heed me any more than if I was a speaking machine—truly, I am not much else. I will, with your leave, relate to you, miss, the story of one of our customers.”' },
    { type: 'p',  text: '“Story!”' },
    { type: 'p',  text: 'He seemed wilfully to mistake the word she had repeated, when he added, in a hurry, “Yes, customers; in the banking business we usually call our connection our customers. He was a French gentleman; a scientific gentleman; a man of great acquirements—a Doctor.”' },
    { type: 'p',  text: '“Not of Beauvais?”' },
    { type: 'p',  text: '“Why, yes, of Beauvais. Like Monsieur Manette, your father, the gentleman was of Beauvais. Like Monsieur Manette, your father, the gentleman was of repute in Paris. I had the honour of knowing him there. Our relations were business relations, but confidential. I was at that time in our French House, and had been—oh! twenty years.”' },
    { type: 'p',  text: '“At that time—I may ask, at what time, sir?”' },
    { type: 'p',  text: '“I speak, miss, of twenty years ago. He married—an English lady—and I was one of the trustees. His affairs, like the affairs of many other French gentlemen and French families, were entirely in Tellson’s hands. In a similar way I am, or I have been, trustee of one kind or other for scores of our customers. These are mere business relations, miss; there is no friendship in them, no particular interest, nothing like sentiment. I have passed from one to another, in the course of my business life, just as I pass from one of our customers to another in the course of my business day; in short, I have no feelings; I am a mere machine. To go on—”' },
    { type: 'p',  text: '“But this is my father’s story, sir; and I begin to think”—the curiously roughened forehead was very intent upon him—“that when I was left an orphan through my mother’s surviving my father only two years, it was you who brought me to England. I am almost sure it was you.”' },
    { type: 'p',  text: 'Mr. Lorry took the hesitating little hand that confidingly advanced to take his, and he put it with some ceremony to his lips. He then conducted the young lady straightway to her chair again, and, holding the chair-back with his left hand, and using his right by turns to rub his chin, pull his wig at the ears, or point what he said, stood looking down into her face while she sat looking up into his.' },
    { type: 'p',  text: '“Miss Manette, it *was* I. And you will see how truly I spoke of myself just now, in saying I had no feelings, and that all the relations I hold with my fellow-creatures are mere business relations, when you reflect that I have never seen you since. No; you have been the ward of Tellson’s House since, and I have been busy with the other business of Tellson’s House since. Feelings! I have no time for them, no chance of them. I pass my whole life, miss, in turning an immense pecuniary Mangle.”' },
    { type: 'p',  text: 'After this odd description of his daily routine of employment, Mr. Lorry flattened his flaxen wig upon his head with both hands (which was most unnecessary, for nothing could be flatter than its shining surface was before), and resumed his former attitude.' },
    { type: 'p',  text: '“So far, miss (as you have remarked), this is the story of your regretted father. Now comes the difference. If your father had not died when he did—Don’t be frightened! How you start!”' },
    { type: 'p',  text: 'She did, indeed, start. And she caught his wrist with both her hands.' },
    { type: 'p',  text: '“Pray,” said Mr. Lorry, in a soothing tone, bringing his left hand from the back of the chair to lay it on the supplicatory fingers that clasped him in so violent a tremble: “pray control your agitation—a matter of business. As I was saying—”' },
    { type: 'p',  text: 'Her look so discomposed him that he stopped, wandered, and began anew:' },
    { type: 'p',  text: '“As I was saying; if Monsieur Manette had not died; if he had suddenly and silently disappeared; if he had been spirited away; if it had not been difficult to guess to what dreadful place, though no art could trace him; if he had an enemy in some compatriot who could exercise a privilege that I in my own time have known the boldest people afraid to speak of in a whisper, across the water there; for instance, the privilege of filling up blank forms for the consignment of any one to the oblivion of a prison for any length of time; if his wife had implored the king, the queen, the court, the clergy, for any tidings of him, and all quite in vain;—then the history of your father would have been the history of this unfortunate gentleman, the Doctor of Beauvais.”' },
    { type: 'p',  text: '“I entreat you to tell me more, sir.”' },
    { type: 'p',  text: '“I will. I am going to. You can bear it?”' },
    { type: 'p',  text: '“I can bear anything but the uncertainty you leave me in at this moment.”' },
    { type: 'p',  text: '“You speak collectedly, and you—*are* collected. That’s good!” (Though his manner was less satisfied than his words.) “A matter of business. Regard it as a matter of business—business that must be done. Now if this doctor’s wife, though a lady of great courage and spirit, had suffered so intensely from this cause before her little child was born—”' },
    { type: 'p',  text: '“The little child was a daughter, sir.”' },
    { type: 'p',  text: '“A daughter. A-a-matter of business—don’t be distressed. Miss, if the poor lady had suffered so intensely before her little child was born, that she came to the determination of sparing the poor child the inheritance of any part of the agony she had known the pains of, by rearing her in the belief that her father was dead—No, don’t kneel! In Heaven’s name why should you kneel to me!”' },
    { type: 'p',  text: '“For the truth. O dear, good, compassionate sir, for the truth!”' },
    { type: 'p',  text: '“A—a matter of business. You confuse me, and how can I transact business if I am confused? Let us be clear-headed. If you could kindly mention now, for instance, what nine times ninepence are, or how many shillings in twenty guineas, it would be so encouraging. I should be so much more at my ease about your state of mind.”' },
    { type: 'p',  text: 'Without directly answering to this appeal, she sat so still when he had very gently raised her, and the hands that had not ceased to clasp his wrists were so much more steady than they had been, that she communicated some reassurance to Mr. Jarvis Lorry.' },
    { type: 'p',  text: '“That’s right, that’s right. Courage! Business! You have business before you; useful business. Miss Manette, your mother took this course with you. And when she died—I believe broken-hearted—having never slackened her unavailing search for your father, she left you, at two years old, to grow to be blooming, beautiful, and happy, without the dark cloud upon you of living in uncertainty whether your father soon wore his heart out in prison, or wasted there through many lingering years.”' },
    { type: 'p',  text: 'As he said the words he looked down, with an admiring pity, on the flowing golden hair; as if he pictured to himself that it might have been already tinged with grey.' },
    { type: 'p',  text: '“You know that your parents had no great possession, and that what they had was secured to your mother and to you. There has been no new discovery, of money, or of any other property; but—”' },
    { type: 'p',  text: 'He felt his wrist held closer, and he stopped. The expression in the forehead, which had so particularly attracted his notice, and which was now immovable, had deepened into one of pain and horror.' },
    { type: 'p',  text: '“But he has been—been found. He is alive. Greatly changed, it is too probable; almost a wreck, it is possible; though we will hope the best. Still, alive. Your father has been taken to the house of an old servant in Paris, and we are going there: I, to identify him if I can: you, to restore him to life, love, duty, rest, comfort.”' },
    { type: 'p',  text: 'A shiver ran through her frame, and from it through his. She said, in a low, distinct, awe-stricken voice, as if she were saying it in a dream,' },
    { type: 'p',  text: '“I am going to see his Ghost! It will be his Ghost—not him!”' },
    { type: 'p',  text: 'Mr. Lorry quietly chafed the hands that held his arm. “There, there, there! See now, see now! The best and the worst are known to you, now. You are well on your way to the poor wronged gentleman, and, with a fair sea voyage, and a fair land journey, you will be soon at his dear side.”' },
    { type: 'p',  text: 'She repeated in the same tone, sunk to a whisper, “I have been free, I have been happy, yet his Ghost has never haunted me!”' },
    { type: 'p',  text: '“Only one thing more,” said Mr. Lorry, laying stress upon it as a wholesome means of enforcing her attention: “he has been found under another name; his own, long forgotten or long concealed. It would be worse than useless now to inquire which; worse than useless to seek to know whether he has been for years overlooked, or always designedly held prisoner. It would be worse than useless now to make any inquiries, because it would be dangerous. Better not to mention the subject, anywhere or in any way, and to remove him—for a while at all events—out of France. Even I, safe as an Englishman, and even Tellson’s, important as they are to French credit, avoid all naming of the matter. I carry about me, not a scrap of writing openly referring to it. This is a secret service altogether. My credentials, entries, and memoranda, are all comprehended in the one line, ‘Recalled to Life;’ which may mean anything. But what is the matter! She doesn’t notice a word! Miss Manette!”' },
    { type: 'p',  text: 'Perfectly still and silent, and not even fallen back in her chair, she sat under his hand, utterly insensible; with her eyes open and fixed upon him, and with that last expression looking as if it were carved or branded into her forehead. So close was her hold upon his arm, that he feared to detach himself lest he should hurt her; therefore he called out loudly for assistance without moving.' },
    { type: 'p',  text: 'A wild-looking woman, whom even in his agitation, Mr. Lorry observed to be all of a red colour, and to have red hair, and to be dressed in some extraordinary tight-fitting fashion, and to have on her head a most wonderful bonnet like a Grenadier wooden measure, and good measure too, or a great Stilton cheese, came running into the room in advance of the inn servants, and soon settled the question of his detachment from the poor young lady, by laying a brawny hand upon his chest, and sending him flying back against the nearest wall.' },
    { type: 'p',  text: '(“I really think this must be a man!” was Mr. Lorry’s breathless reflection, simultaneously with his coming against the wall.)' },
    { type: 'p',  text: '“Why, look at you all!” bawled this figure, addressing the inn servants. “Why don’t you go and fetch things, instead of standing there staring at me? I am not so much to look at, am I? Why don’t you go and fetch things? I’ll let you know, if you don’t bring smelling-salts, cold water, and vinegar, quick, I will.”' },
    { type: 'p',  text: 'There was an immediate dispersal for these restoratives, and she softly laid the patient on a sofa, and tended her with great skill and gentleness: calling her “my precious!” and “my bird!” and spreading her golden hair aside over her shoulders with great pride and care.' },
    { type: 'p',  text: '“And you in brown!” she said, indignantly turning to Mr. Lorry; “couldn’t you tell her what you had to tell her, without frightening her to death? Look at her, with her pretty pale face and her cold hands. Do you call *that* being a Banker?”' },
    { type: 'p',  text: 'Mr. Lorry was so exceedingly disconcerted by a question so hard to answer, that he could only look on, at a distance, with much feebler sympathy and humility, while the strong woman, having banished the inn servants under the mysterious penalty of “letting them know” something not mentioned if they stayed there, staring, recovered her charge by a regular series of gradations, and coaxed her to lay her drooping head upon her shoulder.' },
    { type: 'p',  text: '“I hope she will do well now,” said Mr. Lorry.' },
    { type: 'p',  text: '“No thanks to you in brown, if she does. My darling pretty!”' },
    { type: 'p',  text: '“I hope,” said Mr. Lorry, after another pause of feeble sympathy and humility, “that you accompany Miss Manette to France?”' },
    { type: 'p',  text: '“A likely thing, too!” replied the strong woman. “If it was ever intended that I should go across salt water, do you suppose Providence would have cast my lot in an island?”' },
    { type: 'p',  text: 'This being another question hard to answer, Mr. Jarvis Lorry withdrew to consider it.' },
    { type: 'h2', text: 'Chapter V — The Wine-shop' },
    { type: 'p',  text: 'A large cask of wine had been dropped and broken, in the street. The accident had happened in getting it out of a cart; the cask had tumbled out with a run, the hoops had burst, and it lay on the stones just outside the door of the wine-shop, shattered like a walnut-shell.' },
    { type: 'p',  text: 'All the people within reach had suspended their business, or their idleness, to run to the spot and drink the wine. The rough, irregular stones of the street, pointing every way, and designed, one might have thought, expressly to lame all living creatures that approached them, had dammed it into little pools; these were surrounded, each by its own jostling group or crowd, according to its size. Some men kneeled down, made scoops of their two hands joined, and sipped, or tried to help women, who bent over their shoulders, to sip, before the wine had all run out between their fingers. Others, men and women, dipped in the puddles with little mugs of mutilated earthenware, or even with handkerchiefs from women’s heads, which were squeezed dry into infants’ mouths; others made small mud-embankments, to stem the wine as it ran; others, directed by lookers-on up at high windows, darted here and there, to cut off little streams of wine that started away in new directions; others devoted themselves to the sodden and lee-dyed pieces of the cask, licking, and even champing the moister wine-rotted fragments with eager relish. There was no drainage to carry off the wine, and not only did it all get taken up, but so much mud got taken up along with it, that there might have been a scavenger in the street, if anybody acquainted with it could have believed in such a miraculous presence.' },
    { type: 'p',  text: 'A shrill sound of laughter and of amused voices—voices of men, women, and children—resounded in the street while this wine game lasted. There was little roughness in the sport, and much playfulness. There was a special companionship in it, an observable inclination on the part of every one to join some other one, which led, especially among the luckier or lighter-hearted, to frolicsome embraces, drinking of healths, shaking of hands, and even joining of hands and dancing, a dozen together. When the wine was gone, and the places where it had been most abundant were raked into a gridiron-pattern by fingers, these demonstrations ceased, as suddenly as they had broken out. The man who had left his saw sticking in the firewood he was cutting, set it in motion again; the women who had left on a door-step the little pot of hot ashes, at which she had been trying to soften the pain in her own starved fingers and toes, or in those of her child, returned to it; men with bare arms, matted locks, and cadaverous faces, who had emerged into the winter light from cellars, moved away, to descend again; and a gloom gathered on the scene that appeared more natural to it than sunshine.' },
    { type: 'p',  text: 'The wine was red wine, and had stained the ground of the narrow street in the suburb of Saint Antoine, in Paris, where it was spilled. It had stained many hands, too, and many faces, and many naked feet, and many wooden shoes. The hands of the man who sawed the wood, left red marks on the billets; and the forehead of the woman who nursed her baby, was stained with the stain of the old rag she wound about her head again. Those who had been greedy with the staves of the cask, had acquired a tigerish smear about the mouth; and one tall joker so besmirched, his head more out of a long squalid bag of a nightcap than in it, scrawled upon a wall with his finger dipped in muddy wine-lees—*blood*.' },
    { type: 'p',  text: 'The time was to come, when that wine too would be spilled on the street-stones, and when the stain of it would be red upon many there.' },
    { type: 'p',  text: 'And now that the cloud settled on Saint Antoine, which a momentary gleam had driven from his sacred countenance, the darkness of it was heavy—cold, dirt, sickness, ignorance, and want, were the lords in waiting on the saintly presence—nobles of great power all of them; but, most especially the last. Samples of a people that had undergone a terrible grinding and regrinding in the mill, and certainly not in the fabulous mill which ground old people young, shivered at every corner, passed in and out at every doorway, looked from every window, fluttered in every vestige of a garment that the wind shook. The mill which had worked them down, was the mill that grinds young people old; the children had ancient faces and grave voices; and upon them, and upon the grown faces, and ploughed into every furrow of age and coming up afresh, was the sigh, Hunger. It was prevalent everywhere. Hunger was pushed out of the tall houses, in the wretched clothing that hung upon poles and lines; Hunger was patched into them with straw and rag and wood and paper; Hunger was repeated in every fragment of the small modicum of firewood that the man sawed off; Hunger stared down from the smokeless chimneys, and started up from the filthy street that had no offal, among its refuse, of anything to eat. Hunger was the inscription on the baker’s shelves, written in every small loaf of his scanty stock of bad bread; at the sausage-shop, in every dead-dog preparation that was offered for sale. Hunger rattled its dry bones among the roasting chestnuts in the turned cylinder; Hunger was shred into atomics in every farthing porringer of husky chips of potato, fried with some reluctant drops of oil.' },
    { type: 'p',  text: 'Its abiding place was in all things fitted to it. A narrow winding street, full of offence and stench, with other narrow winding streets diverging, all peopled by rags and nightcaps, and all smelling of rags and nightcaps, and all visible things with a brooding look upon them that looked ill. In the hunted air of the people there was yet some wild-beast thought of the possibility of turning at bay. Depressed and slinking though they were, eyes of fire were not wanting among them; nor compressed lips, white with what they suppressed; nor foreheads knitted into the likeness of the gallows-rope they mused about enduring, or inflicting. The trade signs (and they were almost as many as the shops) were, all, grim illustrations of Want. The butcher and the porkman painted up, only the leanest scrags of meat; the baker, the coarsest of meagre loaves. The people rudely pictured as drinking in the wine-shops, croaked over their scanty measures of thin wine and beer, and were gloweringly confidential together. Nothing was represented in a flourishing condition, save tools and weapons; but, the cutler’s knives and axes were sharp and bright, the smith’s hammers were heavy, and the gunmaker’s stock was murderous. The crippling stones of the pavement, with their many little reservoirs of mud and water, had no footways, but broke off abruptly at the doors. The kennel, to make amends, ran down the middle of the street—when it ran at all: which was only after heavy rains, and then it ran, by many eccentric fits, into the houses. Across the streets, at wide intervals, one clumsy lamp was slung by a rope and pulley; at night, when the lamplighter had let these down, and lighted, and hoisted them again, a feeble grove of dim wicks swung in a sickly manner overhead, as if they were at sea. Indeed they were at sea, and the ship and crew were in peril of tempest.' },
    { type: 'p',  text: 'For, the time was to come, when the gaunt scarecrows of that region should have watched the lamplighter, in their idleness and hunger, so long, as to conceive the idea of improving on his method, and hauling up men by those ropes and pulleys, to flare upon the darkness of their condition. But, the time was not come yet; and every wind that blew over France shook the rags of the scarecrows in vain, for the birds, fine of song and feather, took no warning.' },
    { type: 'p',  text: 'The wine-shop was a corner shop, better than most others in its appearance and degree, and the master of the wine-shop had stood outside it, in a yellow waistcoat and green breeches, looking on at the struggle for the lost wine. “It’s not my affair,” said he, with a final shrug of the shoulders. “The people from the market did it. Let them bring another.”' },
    { type: 'p',  text: 'There, his eyes happening to catch the tall joker writing up his joke, he called to him across the way:' },
    { type: 'p',  text: '“Say, then, my Gaspard, what do you do there?”' },
    { type: 'p',  text: 'The fellow pointed to his joke with immense significance, as is often the way with his tribe. It missed its mark, and completely failed, as is often the way with his tribe too.' },
    { type: 'p',  text: '“What now? Are you a subject for the mad hospital?” said the wine-shop keeper, crossing the road, and obliterating the jest with a handful of mud, picked up for the purpose, and smeared over it. “Why do you write in the public streets? Is there—tell me thou—is there no other place to write such words in?”' },
    { type: 'p',  text: 'In his expostulation he dropped his cleaner hand (perhaps accidentally, perhaps not) upon the joker’s heart. The joker rapped it with his own, took a nimble spring upward, and came down in a fantastic dancing attitude, with one of his stained shoes jerked off his foot into his hand, and held out. A joker of an extremely, not to say wolfishly practical character, he looked, under those circumstances.' },
    { type: 'p',  text: '“Put it on, put it on,” said the other. “Call wine, wine; and finish there.” With that advice, he wiped his soiled hand upon the joker’s dress, such as it was—quite deliberately, as having dirtied the hand on his account; and then recrossed the road and entered the wine-shop.' },
    { type: 'p',  text: 'This wine-shop keeper was a bull-necked, martial-looking man of thirty, and he should have been of a hot temperament, for, although it was a bitter day, he wore no coat, but carried one slung over his shoulder. His shirt-sleeves were rolled up, too, and his brown arms were bare to the elbows. Neither did he wear anything more on his head than his own crisply-curling short dark hair. He was a dark man altogether, with good eyes and a good bold breadth between them. Good-humoured looking on the whole, but implacable-looking, too; evidently a man of a strong resolution and a set purpose; a man not desirable to be met, rushing down a narrow pass with a gulf on either side, for nothing would turn the man.' },
    { type: 'p',  text: 'Madame Defarge, his wife, sat in the shop behind the counter as he came in. Madame Defarge was a stout woman of about his own age, with a watchful eye that seldom seemed to look at anything, a large hand heavily ringed, a steady face, strong features, and great composure of manner. There was a character about Madame Defarge, from which one might have predicated that she did not often make mistakes against herself in any of the reckonings over which she presided. Madame Defarge being sensitive to cold, was wrapped in fur, and had a quantity of bright shawl twined about her head, though not to the concealment of her large earrings. Her knitting was before her, but she had laid it down to pick her teeth with a toothpick. Thus engaged, with her right elbow supported by her left hand, Madame Defarge said nothing when her lord came in, but coughed just one grain of cough. This, in combination with the lifting of her darkly defined eyebrows over her toothpick by the breadth of a line, suggested to her husband that he would do well to look round the shop among the customers, for any new customer who had dropped in while he stepped over the way.' },
    { type: 'p',  text: 'The wine-shop keeper accordingly rolled his eyes about, until they rested upon an elderly gentleman and a young lady, who were seated in a corner. Other company were there: two playing cards, two playing dominoes, three standing by the counter lengthening out a short supply of wine. As he passed behind the counter, he took notice that the elderly gentleman said in a look to the young lady, “This is our man.”' },
    { type: 'p',  text: '“What the devil do *you* do in that galley there?” said Monsieur Defarge to himself; “I don’t know you.”' },
    { type: 'p',  text: 'But, he feigned not to notice the two strangers, and fell into discourse with the triumvirate of customers who were drinking at the counter.' },
    { type: 'p',  text: '“How goes it, Jacques?” said one of these three to Monsieur Defarge. “Is all the spilt wine swallowed?”' },
    { type: 'p',  text: '“Every drop, Jacques,” answered Monsieur Defarge.' },
    { type: 'p',  text: 'When this interchange of Christian name was effected, Madame Defarge, picking her teeth with her toothpick, coughed another grain of cough, and raised her eyebrows by the breadth of another line.' },
    { type: 'p',  text: '“It is not often,” said the second of the three, addressing Monsieur Defarge, “that many of these miserable beasts know the taste of wine, or of anything but black bread and death. Is it not so, Jacques?”' },
    { type: 'p',  text: '“It is so, Jacques,” Monsieur Defarge returned.' },
    { type: 'p',  text: 'At this second interchange of the Christian name, Madame Defarge, still using her toothpick with profound composure, coughed another grain of cough, and raised her eyebrows by the breadth of another line.' },
    { type: 'p',  text: 'The last of the three now said his say, as he put down his empty drinking vessel and smacked his lips.' },
    { type: 'p',  text: '“Ah! So much the worse! A bitter taste it is that such poor cattle always have in their mouths, and hard lives they live, Jacques. Am I right, Jacques?”' },
    { type: 'p',  text: '“You are right, Jacques,” was the response of Monsieur Defarge.' },
    { type: 'p',  text: 'This third interchange of the Christian name was completed at the moment when Madame Defarge put her toothpick by, kept her eyebrows up, and slightly rustled in her seat.' },
    { type: 'p',  text: '“Hold then! True!” muttered her husband. “Gentlemen—my wife!”' },
    { type: 'p',  text: 'The three customers pulled off their hats to Madame Defarge, with three flourishes. She acknowledged their homage by bending her head, and giving them a quick look. Then she glanced in a casual manner round the wine-shop, took up her knitting with great apparent calmness and repose of spirit, and became absorbed in it.' },
    { type: 'p',  text: '“Gentlemen,” said her husband, who had kept his bright eye observantly upon her, “good day. The chamber, furnished bachelor-fashion, that you wished to see, and were inquiring for when I stepped out, is on the fifth floor. The doorway of the staircase gives on the little courtyard close to the left here,” pointing with his hand, “near to the window of my establishment. But, now that I remember, one of you has already been there, and can show the way. Gentlemen, adieu!”' },
    { type: 'p',  text: 'They paid for their wine, and left the place. The eyes of Monsieur Defarge were studying his wife at her knitting when the elderly gentleman advanced from his corner, and begged the favour of a word.' },
    { type: 'p',  text: '“Willingly, sir,” said Monsieur Defarge, and quietly stepped with him to the door.' },
    { type: 'p',  text: 'Their conference was very short, but very decided. Almost at the first word, Monsieur Defarge started and became deeply attentive. It had not lasted a minute, when he nodded and went out. The gentleman then beckoned to the young lady, and they, too, went out. Madame Defarge knitted with nimble fingers and steady eyebrows, and saw nothing.' },
    { type: 'p',  text: 'Mr. Jarvis Lorry and Miss Manette, emerging from the wine-shop thus, joined Monsieur Defarge in the doorway to which he had directed his own company just before. It opened from a stinking little black courtyard, and was the general public entrance to a great pile of houses, inhabited by a great number of people. In the gloomy tile-paved entry to the gloomy tile-paved staircase, Monsieur Defarge bent down on one knee to the child of his old master, and put her hand to his lips. It was a gentle action, but not at all gently done; a very remarkable transformation had come over him in a few seconds. He had no good-humour in his face, nor any openness of aspect left, but had become a secret, angry, dangerous man.' },
    { type: 'p',  text: '“It is very high; it is a little difficult. Better to begin slowly.” Thus, Monsieur Defarge, in a stern voice, to Mr. Lorry, as they began ascending the stairs.' },
    { type: 'p',  text: '“Is he alone?” the latter whispered.' },
    { type: 'p',  text: '“Alone! God help him, who should be with him!” said the other, in the same low voice.' },
    { type: 'p',  text: '“Is he always alone, then?”' },
    { type: 'p',  text: '“Yes.”' },
    { type: 'p',  text: '“Of his own desire?”' },
    { type: 'p',  text: '“Of his own necessity. As he was, when I first saw him after they found me and demanded to know if I would take him, and, at my peril be discreet—as he was then, so he is now.”' },
    { type: 'p',  text: '“He is greatly changed?”' },
    { type: 'p',  text: '“Changed!”' },
    { type: 'p',  text: 'The keeper of the wine-shop stopped to strike the wall with his hand, and mutter a tremendous curse. No direct answer could have been half so forcible. Mr. Lorry’s spirits grew heavier and heavier, as he and his two companions ascended higher and higher.' },
    { type: 'p',  text: 'Such a staircase, with its accessories, in the older and more crowded parts of Paris, would be bad enough now; but, at that time, it was vile indeed to unaccustomed and unhardened senses. Every little habitation within the great foul nest of one high building—that is to say, the room or rooms within every door that opened on the general staircase—left its own heap of refuse on its own landing, besides flinging other refuse from its own windows. The uncontrollable and hopeless mass of decomposition so engendered, would have polluted the air, even if poverty and deprivation had not loaded it with their intangible impurities; the two bad sources combined made it almost insupportable. Through such an atmosphere, by a steep dark shaft of dirt and poison, the way lay. Yielding to his own disturbance of mind, and to his young companion’s agitation, which became greater every instant, Mr. Jarvis Lorry twice stopped to rest. Each of these stoppages was made at a doleful grating, by which any languishing good airs that were left uncorrupted, seemed to escape, and all spoilt and sickly vapours seemed to crawl in. Through the rusted bars, tastes, rather than glimpses, were caught of the jumbled neighbourhood; and nothing within range, nearer or lower than the summits of the two great towers of Notre-Dame, had any promise on it of healthy life or wholesome aspirations.' },
    { type: 'p',  text: 'At last, the top of the staircase was gained, and they stopped for the third time. There was yet an upper staircase, of a steeper inclination and of contracted dimensions, to be ascended, before the garret story was reached. The keeper of the wine-shop, always going a little in advance, and always going on the side which Mr. Lorry took, as though he dreaded to be asked any question by the young lady, turned himself about here, and, carefully feeling in the pockets of the coat he carried over his shoulder, took out a key.' },
    { type: 'p',  text: '“The door is locked then, my friend?” said Mr. Lorry, surprised.' },
    { type: 'p',  text: '“Ay. Yes,” was the grim reply of Monsieur Defarge.' },
    { type: 'p',  text: '“You think it necessary to keep the unfortunate gentleman so retired?”' },
    { type: 'p',  text: '“I think it necessary to turn the key.” Monsieur Defarge whispered it closer in his ear, and frowned heavily.' },
    { type: 'p',  text: '“Why?”' },
    { type: 'p',  text: '“Why! Because he has lived so long, locked up, that he would be frightened—rave—tear himself to pieces—die—come to I know not what harm—if his door was left open.”' },
    { type: 'p',  text: '“Is it possible!” exclaimed Mr. Lorry.' },
    { type: 'p',  text: '“Is it possible!” repeated Defarge, bitterly. “Yes. And a beautiful world we live in, when it *is* possible, and when many other such things are possible, and not only possible, but done—done, see you!—under that sky there, every day. Long live the Devil. Let us go on.”' },
    { type: 'p',  text: 'This dialogue had been held in so very low a whisper, that not a word of it had reached the young lady’s ears. But, by this time she trembled under such strong emotion, and her face expressed such deep anxiety, and, above all, such dread and terror, that Mr. Lorry felt it incumbent on him to speak a word or two of reassurance.' },
    { type: 'p',  text: '“Courage, dear miss! Courage! Business! The worst will be over in a moment; it is but passing the room-door, and the worst is over. Then, all the good you bring to him, all the relief, all the happiness you bring to him, begin. Let our good friend here, assist you on that side. That’s well, friend Defarge. Come, now. Business, business!”' },
    { type: 'p',  text: 'They went up slowly and softly. The staircase was short, and they were soon at the top. There, as it had an abrupt turn in it, they came all at once in sight of three men, whose heads were bent down close together at the side of a door, and who were intently looking into the room to which the door belonged, through some chinks or holes in the wall. On hearing footsteps close at hand, these three turned, and rose, and showed themselves to be the three of one name who had been drinking in the wine-shop.' },
    { type: 'p',  text: '“I forgot them in the surprise of your visit,” explained Monsieur Defarge. “Leave us, good boys; we have business here.”' },
    { type: 'p',  text: 'The three glided by, and went silently down.' },
    { type: 'p',  text: 'There appearing to be no other door on that floor, and the keeper of the wine-shop going straight to this one when they were left alone, Mr. Lorry asked him in a whisper, with a little anger:' },
    { type: 'p',  text: '“Do you make a show of Monsieur Manette?”' },
    { type: 'p',  text: '“I show him, in the way you have seen, to a chosen few.”' },
    { type: 'p',  text: '“Is that well?”' },
    { type: 'p',  text: '“*I* think it is well.”' },
    { type: 'p',  text: '“Who are the few? How do you choose them?”' },
    { type: 'p',  text: '“I choose them as real men, of my name—Jacques is my name—to whom the sight is likely to do good. Enough; you are English; that is another thing. Stay there, if you please, a little moment.”' },
    { type: 'p',  text: 'With an admonitory gesture to keep them back, he stooped, and looked in through the crevice in the wall. Soon raising his head again, he struck twice or thrice upon the door—evidently with no other object than to make a noise there. With the same intention, he drew the key across it, three or four times, before he put it clumsily into the lock, and turned it as heavily as he could.' },
    { type: 'p',  text: 'The door slowly opened inward under his hand, and he looked into the room and said something. A faint voice answered something. Little more than a single syllable could have been spoken on either side.' },
    { type: 'p',  text: 'He looked back over his shoulder, and beckoned them to enter. Mr. Lorry got his arm securely round the daughter’s waist, and held her; for he felt that she was sinking.' },
    { type: 'p',  text: '“A-a-a-business, business!” he urged, with a moisture that was not of business shining on his cheek. “Come in, come in!”' },
    { type: 'p',  text: '“I am afraid of it,” she answered, shuddering.' },
    { type: 'p',  text: '“Of it? What?”' },
    { type: 'p',  text: '“I mean of him. Of my father.”' },
    { type: 'p',  text: 'Rendered in a manner desperate, by her state and by the beckoning of their conductor, he drew over his neck the arm that shook upon his shoulder, lifted her a little, and hurried her into the room. He sat her down just within the door, and held her, clinging to him.' },
    { type: 'p',  text: 'Defarge drew out the key, closed the door, locked it on the inside, took out the key again, and held it in his hand. All this he did, methodically, and with as loud and harsh an accompaniment of noise as he could make. Finally, he walked across the room with a measured tread to where the window was. He stopped there, and faced round.' },
    { type: 'p',  text: 'The garret, built to be a depository for firewood and the like, was dim and dark: for, the window of dormer shape, was in truth a door in the roof, with a little crane over it for the hoisting up of stores from the street: unglazed, and closing up the middle in two pieces, like any other door of French construction. To exclude the cold, one half of this door was fast closed, and the other was opened but a very little way. Such a scanty portion of light was admitted through these means, that it was difficult, on first coming in, to see anything; and long habit alone could have slowly formed in any one, the ability to do any work requiring nicety in such obscurity. Yet, work of that kind was being done in the garret; for, with his back towards the door, and his face towards the window where the keeper of the wine-shop stood looking at him, a white-haired man sat on a low bench, stooping forward and very busy, making shoes.' },
  ]),
  'Staatliche Bauhaus': makeBlocks([
    { type: 'h2', text: 'Walter Gropius, 1919' },
    { type: 'h1', text: 'Staatliche Bauhaus' },
    { type: 'p',  text: 'Das Staatliche Bauhaus in Weimar int durch Vereinigung der ehemaligen Großherzoglich Sächsischen Hochschule für bildende Kunst mit der ehemaligen Großherzoglich Sächsischen Kunstgewerbeschule unter Neuangliediederung einer Abteilung für Baukunst enstanden.' },
    { type: 'p',  text: 'Das Bauhaus erstrebt die Sammlung alles künstlerischen Schaffens zur Einheit, die Wiedervereinigung aller werke künstlerischen Disziplinen — Bildhauerei, Malerei, Kunstgewerbe und Handwerk — zu einer neuen Baukunst als deren unablösliehe Bestandteile. Das letzte, wenn auch ferne Ziel des Bauhauses ist das Einheits Kunstwerk — der große Bau — in dem es keine Grenze gibt zwischen monumentaler und dekorativer Kunst.' },
    { type: 'p',  text: 'Das Bauhaus will Architekten, Maler und Bildhauer aller Grade je nach ihren Fähigkeiten zu tüchtigen Handwerkern oder selbständig schaffenden Künstlern erziehen und eine Arbeitsgemeinschaft führender und werdender Werk Künstler gründen, die Bauwerke in ihrer Gesamtheit — Rohbau, Ausbau, Ausschmückung und Einrichtung — aus gleich gearteter Geist heraus einheitlich zu gestalten weiß.' },
    { type: 'p',  text: 'Kunst entsteht oberhalb aller Methoden, sie ist an sich nicht lehrbar, wohl aber das Handwerk., Architekten, Maler, Bildhauer sind Handwerker im Ursinn des Wortes, deshalb wird als unerlaßliche Grundlage für alles bildnerische Schaffen die gründliche handwerkliche Ausbildung aller Studierenden in Werkstätten und auf Probier- und Werk-plätzen gefordert. Die eigenen Werkstätten sollen allmählich ausgebaut, mit fremden Werkstätten Lehrverträge abgeschlossen werden.' },
    { type: 'p',  text: 'Die Schule ist die Dienerin der Werkstatt, sie wird eines Tages in ihr aufgehen. Deshalb nicht Lehrer und Schüler im Bauhaus, sondern Meister, Gesellen und Lehrlinge.' },
  ]),
  'Kern King': makeBlocks([
    { type: 'h1', text: 'Kern King' },
    { type: 'h2', text: 'Part 1 — Lowercase' },
    { type: 'p',  text: 'lynx tuft frogs, dolphins abduct by proxy the ever awkward klutz, dud, dummkopf, jinx snubnose filmgoer, orphan sgt. renfruw grudgek reyfus, md. sikh psych if halt tympany jewelry sri heh! twyer vs jojo pneu fylfot alcaaba son of nonplussed halfbreed bubbly playboy guggenheim daddy coccyx sgraffito effect, vacuum dirndle impossible attempt to disvalue, muzzle the afghan czech czar and exninja, bob bixby dvorak wood dhurrie savvy, dizzy eye aeon circumcision uvula scrungy picnic luxurious special type carbohydrate ovoid adzuki kumquat bomb? afterglows gold girl pygmy gnome lb. ankhs acme aggroupment akmed brouhha tv wt. ujjain ms. oz abacus mnemonics bhikku khaki bwana aorta embolism vivid owls often kvetch otherwise, wysiwyg densfort wright you\'ve absorbed rhythm, put obstacle kyaks krieg kern wurst subject enmity equity coquet quorum pique tzetse hepzibah sulfhydryl briefcase ajax ehler kafka fjord elfship halfdressed jugful eggcup hummingbirds swingdevil bagpipe legwork reproachful hunchback archknave baghdad wejh rijswijk rajbansi rajput ajdir okay weekday obfuscate subpoena liebknecht marcgravia ecbolic arcticward dickcissel pincpinc boldface maidkin adjective adcraft adman dwarfness applejack darkbrown kiln palzy always farmland flimflam unbossy nonlineal stepbrother lapdog stopgap sx countdown basketball beaujolais vb. flowchart aztec lazy bozo syrup tarzan annoying dyke yucky hawg gagzhukz cuzco squire when hiho mayhem nietzsche szasz gumdrop milk emplotment ambidextrously lacquer byway ecclesiastes stubchen hobgoblins crabmill aqua hawaii blvd. subquality byzantine empire debt obvious cervantes jekabzeel anecdote flicflac mechanicville bedbug couldn\'t i\'ve it\'s they\'ll they\'d dpt. headquarter burkhardt xerxes atkins govt. ebenezer lg. lhama amtrak amway fixity axmen quumbabda upjohn hrumpf' },
    { type: 'h2', text: 'Part 2 — Uppercase' },
    { type: 'p',  text: 'LYNX TUFT FROGS, DOLPHINS ABDUCT BY PROXY THE EVER AWKWARD KLUTZ, DUD, DUMMKOPF, JINX SNUBNOSE FILMGOER, ORPHAN SGT. RENFRUW GRUDGEK REYFUS, MD. SIKH PSYCH IF HALT TYMPANY JEWELRY SRI HEH! TWYER VS JOJO PNEU FYLFOT ALCAABA SON OF NONPLUSSED HALFBREED BUBBLY PLAYBOY GUGGENHEIM DADDY COCCYX SGRAFFITO EFFECT, VACUUM DIRNDLE IMPOSSIBLE ATTEMPT TO DISVALUE, MUZZLE THE AFGHAN CZECH CZAR AND EXNINJA, BOB BIXBY DVORAK WOOD DHURRIE SAVVY, DIZZY EYE AEON CIRCUMCISION UVULA SCRUNGY PICNIC LUXURIOUS SPECIAL TYPE CARBOHYDRATE OVOID ADZUKI KUMQUAT BOMB? AFTERGLOWS GOLD GIRL PYGMY GNOME LB. ANKHS ACME AGGROUPMENT AKMED BROUHHA TV WT. UJJAIN MS. OZ ABACUS MNEMONICS BHIKKU KHAKI BWANA AORTA EMBOLISM VIVID OWLS OFTEN KVETCH OTHERWISE, WYSIWYG DENSFORT WRIGHT YOU\'VE ABSORBED RHYTHM, PUT OBSTACLE KYAKS KRIEG KERN WURST SUBJECT ENMITY EQUITY COQUET QUORUM PIQUE TZETSE HEPZIBAH SULFHYDRYL BRIEFCASE AJAX EHLER KAFKA FJORD ELFSHIP HALFDRESSED JUGFUL EGGCUP HUMMINGBIRDS SWINGDEVIL BAGPIPE LEGWORK REPROACHFUL HUNCHBACK ARCHKNAVE BAGHDAD WEJH RIJSWIJK RAJBANSI RAJPUT AJDIR OKAY WEEKDAY OBFUSCATE SUBPOENA LIEBKNECHT MARCGRAVIA ECBOLIC ARCTICWARD DICKCISSEL PINCPINC BOLDFACE MAIDKIN ADJECTIVE ADCRAFT ADMAN DWARFNESS APPLEJACK DARKBROWN KILN PALZY ALWAYS FARMLAND FLIMFLAM UNBOSSY NONLINEAL STEPBROTHER LAPDOG STOPGAP SX COUNTDOWN BASKETBALL BEAUJOLAIS VB. FLOWCHART AZTEC LAZY BOZO SYRUP TARZAN ANNOYING DYKE YUCKY HAWG GAGZHUKZ CUZCO SQUIRE WHEN HIHO MAYHEM NIETZSCHE SZASZ GUMDROP MILK EMPLOTMENT AMBIDEXTROUSLY LACQUER BYWAY ECCLESIASTES STUBCHEN HOBGOBLINS CRABMILL AQUA HAWAII BLVD. SUBQUALITY BYZANTINE EMPIRE DEBT OBVIOUS CERVANTES JEKABZEEL ANECDOTE FLICFLAC MECHANICVILLE BEDBUG COULDN\'T I\'VE IT\'S THEY\'LL THEY\'D DPT. HEADQUARTER BURKHARDT XERXES ATKINS GOVT. EBENEZER LG. LHAMA AMTRAK AMWAY FIXITY AXMEN QUUMBABDA UPJOHN HRUMPF' },
    { type: 'h2', text: 'Part 3 — Sentence Case' },
    { type: 'p',  text: 'Aaron Abraham Adam Aeneas Agfa Ahoy Aileen Akbar Alanon Americanism Anglican Aorta April Fool\'s Day Aqua Lung (Tm.) Arabic Ash Wednesday Authorized Version Ave Maria Away Axel Ay Aztec Bhutan Bill Bjorn Bk Btu. Bvart Bzonga California Cb Cd Cervantes Chicago Clute City, Tx. Cmdr. Cnossus Coco Cracker State, Georgia Cs Ct. Cwacker Cyrano David Debra Dharma Diane Djakarta Dm Dnepr Doris Dudley Dwayne Dylan Dzerzhinsk Eames Ectomorph Eden Eerie Effingham, Il. Egypt Eiffel Tower Eject Ekland Elmore Entreaty Eolian Epstein Equine Erasmus Eskimo Ethiopia Europe Eva Ewan Exodus Jan van Eyck Ezra Fabian February Fhara Fifi Fjord Florida Fm France Fs Ft. Fury Fyn Gabriel Gc Gdynia Gehrig Ghana Gilligan Karl Gjellerup Gk. Glen Gm Gnosis Gp.E. Gregory Gs Gt. Br. Guinevere Gwathmey Gypsy Gzags Hebrew Hf Hg Hileah Horace Hrdlicka Hsia Hts. Hubert Hwang Hai Hyacinth Hz. Iaccoca Ibsen Iceland Idaho If Iggy Ihre Ijit Ike Iliad Immediate Innocent Ione Ipswitch Iquarus Ireland Island It Iud Ivert Iwerks Ixnay Iy Jasper Jenks Jherry Jill Jm Jn Jorge Jr. Julie Kerry Kharma Kiki Klear Koko Kruse Kusack Kylie Laboe Lb. Leslie Lhihane Llama Lorrie Lt. Lucy Lyle Madeira Mechanic Mg. Minnie Morrie Mr. Ms. Mt. Music My Nanny Nellie Nillie Novocane Null Nyack Oak Oblique Occarina Odd Oedipus Off Ogmane Ohio Oil Oj Oklahoma Olio Omni Only Oops Opera Oqu Order Ostra Ottmar Out Ovum Ow Ox Oyster Oz Parade Pd. Pepe Pfister Pg. Phil Pippi Pj Please Pneumonia Porridge Price Psalm Pt. Purple Pv Pw Pyre Qt. Quincy Radio Rd. Red Rhea Right Rj Roche Rr Rs Rt. Rural Rwanda Ryder Sacrifice Series Sgraffito Shirt Sister Skeet Slow Smore Snoop Soon Special Squire Sr St. Suzy Svelte Swiss Sy Szach Td Teach There Title Total Trust Tsena Tulip Twice Tyler Tzean Ua Udder Ue Uf Ugh Uh Ui Uk Ul Um Unkempt Uo Up Uq Ursula Use Utmost Uvula Uw Uxurious Uzßai Valerie Velour Vh Vicky Volvo Vs Water Were Where With World Wt. Wulk Wyler Xavier Xerox Xi Xylophone Yaboe Year Yipes Yo Ypsilant Ys Yu Zabar\'s Zero Zhane Zizi Zorro Zu Zy Don\'t I\'ll I\'m I\'se' },
    { type: 'h2', text: 'Part 4 — Numbers' },
    { type: 'p',  text: '0010203040500607080900 10112131415116171819100 20212232425226272829200 30313233435336373839300 40414243445446474849400 50515253545556575859500 6061626364656676869600 7071727374757677879700 8081828384858687889800 9091929394959697989900 (1)(2)(3)(4)(5)(6)(7)(8)(9)(0) $00 $10 $20 $30 $40 $50 $60 $70 $80 $90 £00 £10 £20 £30 £40 £50 £60 £70 £80 £90 00¢ 11¢ 22¢ 33¢ 44¢ 55¢ 66¢ 77¢ 88¢ 99¢ 00% 0‰ 0-0.0,0…0° 11% 1‰ 1-1.1,1…1° 12% 2‰ 2-2.2,2…2° 13% 3‰ 3-3.3,3…3° 14% 4‰ 4-4.4,4…4° 15% 5‰ 5-5.5,5…5° 16% 6‰ 6-6.6,6…6° 17% 7‰ 7-7.7,7…7° 18% 8‰ 8-8.8,8…8° 19% 9‰ 9-9.9,9…9°' },
  ]),
}

const SAMPLE_BLOCKS = TEXT_PRESETS['Sample']

// ── Cal.com type role model ───────────────────────────────────────────────────
const CALCOM_ROLE_LABELS = {
  eventHost: 'Host', eventTitle: 'Title', eventDesc: 'Desc',
  eventMeta: 'Meta', calHeader: 'Cal',   calDay: 'Day', timeSlot: 'Time',
}
const DEFAULT_CALCOM_ROLES = {
  eventHost:  { size: 14, tracking: 0,      leading: 1.4, axisOverrides: {} },
  eventTitle: { size: 28, tracking: 0, interTracking: -0.015, leading: 1.1, axisOverrides: { wght: 700, opsz: 'auto', GEOM: 50 } },
  eventDesc:  { size: 13, tracking: 0,      leading: 1.5, axisOverrides: {} },
  eventMeta:  { size: 13, tracking: 0,      leading: 1.4, axisOverrides: {} },
  calHeader:  { size: 11, tracking: 0.05,   leading: 1,   axisOverrides: { wght: 500 } },
  calDay:     { size: 13, tracking: 0,      leading: 1,   axisOverrides: {} },
  timeSlot:   { size: 14, tracking: 0,      leading: 1,   axisOverrides: {} },
}

// ── Coss (booking events) type role model ────────────────────────────────────
const COSS_ROLE_LABELS = {
  navLabel: 'Nav', pageTitle: 'Title', cardTitle: 'Event',
  cardSlug: 'Slug', cardDesc: 'Desc', badge: 'Badge',
}
const DEFAULT_COSS_ROLES = {
  navLabel:  { size: 14, tracking: 0,      leading: 1.4, axisOverrides: {} },
  pageTitle: { size: 20, tracking: -0.01,  leading: 1.2, axisOverrides: { wght: 700, opsz: 'auto', GEOM: 50 } },
  cardTitle: { size: 14, tracking: 0,      leading: 1.3, axisOverrides: { wght: 500 } },
  cardSlug:  { size: 12, tracking: 0,      leading: 1.4, axisOverrides: {} },
  cardDesc:  { size: 13, tracking: 0,      leading: 1.5, axisOverrides: {} },
  badge:     { size: 11, tracking: 0,      leading: 1,   axisOverrides: {} },
}

// ── Paragraph style model ────────────────────────────────────────────────────
// Per-block overrides (weight/italic/ss04/ss05) default to null = inherit the
// global control, mirroring how axisOverrides inherit axisValues.
const DEFAULT_PARA_STYLES = {
  h1: { size: 57, leading: 1.1, tracking: 0,     axisOverrides: { wght: 700, opsz: 'auto' }, weight: null, italic: null, ss04: null, ss05: null },
  h2: { size: 32, leading: 1.2, tracking: 0,     axisOverrides: { wght: 400, opsz: 'auto' }, weight: null, italic: null, ss04: null, ss05: null },
  h3: { size: 22, leading: 1.3, tracking: 0,     axisOverrides: { opsz: 'auto' }, weight: null, italic: null, ss04: null, ss05: null },
  p:  { size: 18, leading: 1.6, tracking: 0,     axisOverrides: { opsz: 'auto' }, weight: null, italic: null, ss04: null, ss05: null },
}

// Shared feature string. ss04 fires only in italic, ss05 only in roman.
function featureStr(italic, s04, s05) {
  const feats = ['"calt" 0', '"ss20" 0']
  if (s04 && italic) feats.push('"ss04" 1')
  if (s05 && !italic) feats.push('"ss05" 1')
  return feats.join(', ')
}

// ── Tailwind type scale ───────────────────────────────────────────────────────
const TAILWIND_SCALE = [
  { key: 'text-xs',   pxSize: 12,  lh: 1 / 0.75 },
  { key: 'text-sm',   pxSize: 14,  lh: 1.25 / 0.875 },
  { key: 'text-base', pxSize: 16,  lh: 1.5 },
  { key: 'text-lg',   pxSize: 18,  lh: 1.75 / 1.125 },
  { key: 'text-xl',   pxSize: 20,  lh: 1.75 / 1.25 },
  { key: 'text-2xl',  pxSize: 24,  lh: 2 / 1.5 },
  { key: 'text-3xl',  pxSize: 30,  lh: 2.25 / 1.875 },
  { key: 'text-4xl',  pxSize: 36,  lh: 2.5 / 2.25 },
  { key: 'text-5xl',  pxSize: 48,  lh: 1 },
  { key: 'text-6xl',  pxSize: 60,  lh: 1 },
  { key: 'text-7xl',  pxSize: 72,  lh: 1 },
  { key: 'text-8xl',  pxSize: 96,  lh: 1 },
  { key: 'text-9xl',  pxSize: 128, lh: 1 },
]
// xs–lg are always visible; xl–9xl are controlled by scaleMaxXl
const TAILWIND_BASE = TAILWIND_SCALE.slice(0, 4)
const TAILWIND_XL   = TAILWIND_SCALE.slice(4)

const SCALE_PAIR_TEXT = 'A wonderful serenity has taken possession of my entire soul, like these sweet mornings of spring which I enjoy with my whole heart. I am alone, and feel the charm of existence in this spot, which was created for the bliss of souls like mine.'

const DEFAULT_SCALE_AXIS_OVERRIDES = Object.fromEntries(TAILWIND_SCALE.map(s => [s.key, { opsz: 'auto' }]))

// ── Cursor utilities ─────────────────────────────────────────────────────────
function placeCursorAtEnd(el) {
  const range = document.createRange()
  const sel = window.getSelection()
  range.selectNodeContents(el)
  range.collapse(false)
  sel.removeAllRanges()
  sel.addRange(range)
}

function placeCursorAtStart(el) {
  const range = document.createRange()
  const sel = window.getSelection()
  range.setStart(el, 0)
  range.collapse(true)
  sel.removeAllRanges()
  sel.addRange(range)
}

// Place the caret at a character offset within el's first text node.
function placeCursorAtOffset(el, offset) {
  const tn = el.firstChild
  const len = tn?.textContent?.length ?? 0
  const range = document.createRange()
  const sel = window.getSelection()
  range.setStart(tn ?? el, Math.min(Math.max(offset, 0), len))
  range.collapse(true)
  sel.removeAllRanges()
  sel.addRange(range)
}

// Character offset within el at a viewport point, so clicking into a styled block
// lands the caret where you clicked rather than at the start.
function caretCharOffset(el, x, y) {
  const doc = el.ownerDocument
  let node = null, offset = 0
  if (doc.caretPositionFromPoint) {
    const p = doc.caretPositionFromPoint(x, y)
    if (p) { node = p.offsetNode; offset = p.offset }
  } else if (doc.caretRangeFromPoint) {
    const rr = doc.caretRangeFromPoint(x, y)
    if (rr) { node = rr.startContainer; offset = rr.startOffset }
  }
  if (!node || !el.contains(node)) return el.textContent?.length ?? 0
  const r = document.createRange()
  r.selectNodeContents(el)
  r.setEnd(node, offset)
  return r.toString().length
}

// Inline semi-markup → styled React nodes: **bold**, *italic*, __underline__.
// Matched delimiters, non-greedy, no nesting. `italicStyle` / `boldStyle` are
// per-font CSS style objects (resolved from blockStyle) so each deployment's
// font renders its own italic/bold — variable axis or separate face alike.
const INLINE_RE = /(\*\*|__|\*)(.+?)\1/g
function renderInline(text, italicStyle, boldStyle) {
  if (!/[*_]/.test(text)) return text
  const out = []
  let last = 0, k = 0, m
  const re = new RegExp(INLINE_RE)
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index))
    const delim = m[1], inner = m[2]
    if (delim === '**') out.push(<strong key={k++} style={boldStyle}>{inner}</strong>)
    else if (delim === '*') out.push(<em key={k++} style={italicStyle}>{inner}</em>)
    else out.push(<u key={k++}>{inner}</u>)
    last = m.index + m[0].length
  }
  if (last < text.length) out.push(text.slice(last))
  return out
}

function caretAtStart(el) {
  const sel = window.getSelection()
  if (!sel.rangeCount) return false
  const range = sel.getRangeAt(0)
  if (!range.collapsed) return false
  const pre = range.cloneRange()
  pre.selectNodeContents(el)
  pre.setEnd(range.startContainer, range.startOffset)
  return pre.toString().length === 0
}

// Returns merged, sorted [start, end] codepoint ranges the font's cmap supports,
// or null if no usable Unicode cmap is found. Handles formats 0, 4, 6, 12. (TTF/OTF only.)
function parseCmapRanges(ab) {
  try {
    const data = new DataView(ab)
    const numTables = data.getUint16(4)
    let cmapOffset = 0
    for (let i = 0; i < numTables; i++) {
      const t = String.fromCharCode(data.getUint8(12+i*16), data.getUint8(13+i*16), data.getUint8(14+i*16), data.getUint8(15+i*16))
      if (t === 'cmap') { cmapOffset = data.getUint32(12+i*16+8); break }
    }
    if (!cmapOffset) return null
    const numSub = data.getUint16(cmapOffset + 2)
    const subOffsets = []
    for (let i = 0; i < numSub; i++) subOffsets.push(cmapOffset + data.getUint32(cmapOffset + 4 + i*8 + 4))
    const cps = new Set()
    for (const off of subOffsets) {
      const format = data.getUint16(off)
      if (format === 0) {
        for (let c = 0; c < 256; c++) if (data.getUint8(off + 6 + c) !== 0) cps.add(c)
      } else if (format === 4) {
        const segX2 = data.getUint16(off + 6)
        const endBase = off + 14, startBase = endBase + segX2 + 2
        const deltaBase = startBase + segX2, rangeBase = deltaBase + segX2
        for (let s = 0; s < segX2/2; s++) {
          const end = data.getUint16(endBase + s*2), start = data.getUint16(startBase + s*2)
          const delta = data.getInt16(deltaBase + s*2), ro = data.getUint16(rangeBase + s*2)
          if (start === 0xFFFF) continue
          for (let c = start; c <= end && c !== 0xFFFF; c++) {
            let g
            if (ro === 0) g = (c + delta) & 0xFFFF
            else { g = data.getUint16(rangeBase + s*2 + ro + (c - start)*2); if (g !== 0) g = (g + delta) & 0xFFFF }
            if (g !== 0) cps.add(c)
          }
        }
      } else if (format === 6) {
        const first = data.getUint16(off + 6), count = data.getUint16(off + 8)
        for (let i = 0; i < count; i++) if (data.getUint16(off + 10 + i*2) !== 0) cps.add(first + i)
      } else if (format === 12) {
        const nGroups = data.getUint32(off + 12)
        for (let gi = 0; gi < nGroups; gi++) {
          const g = off + 16 + gi*12
          const startC = data.getUint32(g), endC = data.getUint32(g + 4), startGID = data.getUint32(g + 8)
          for (let c = startC; c <= endC; c++) if (startGID + (c - startC) !== 0) cps.add(c)
        }
      }
    }
    if (cps.size === 0) return null
    const sorted = Array.from(cps).sort((a, b) => a - b)
    const ranges = []
    let s = sorted[0], p = sorted[0]
    for (let i = 1; i < sorted.length; i++) {
      if (sorted[i] === p + 1) { p = sorted[i]; continue }
      ranges.push([s, p]); s = p = sorted[i]
    }
    ranges.push([s, p])
    return ranges
  } catch { return null }
}

const GLYPH_SETS = (() => {
  const groups = {
    'Uppercase': [
      ...'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
      ...'ÀÁÂÃÄÅÆÇÈÉÊËÌÍÎÏÐÑÒÓÔÕÖØÙÚÛÜÝÞ',
      'ẞ',
      ...'ĀĂĄĆĈĊČĎĐĒĔĖĘĚĜĞĠĢĤĦĨĪĬĮİĲĴĶĹĻĽĿŁŃŅŇŊŌŎŐŒŔŖŘŚŜŞŠŢŤŦŨŪŬŮŰŲŴŶŸŹŻŽ',
    ],
    'Lowercase': [
      ...'abcdefghijklmnopqrstuvwxyz',
      'ß',
      ...'àáâãäåæçèéêëìíîïðñòóôõöøùúûüýþÿ',
      ...'āăąćĉċčďđēĕėęěĝğġģĥħĩīĭįıĳĵķĸĺļľŀłńņňŉŋōŏőœŕŗřśŝşšţťŧũūŭůűųŵŷźżž',
    ],
    'Numerals': [
      ...'0123456789',
      ...'⁰¹²³⁴⁵⁶⁷⁸⁹',
      ...'₀₁₂₃₄₅₆₇₈₉',
      ...'¼½¾⅓⅔⅛⅜⅝⅞',
      ...'ªº',
    ],
    'Symbols': [
      ...'.,:;!¡?¿',
      '"', "'",
      ...'-‒–—…',
      ...'()[]{}',
      ...'/\\|',
      ...'@#%&*+=<>~`^_',
      ...'‘’“”‚„«»‹›',
      ...'©®™°•·¶§¦',
      ...'±×÷≠≈≤≥∞',
      ...'$€£¥¢₩₪₫₿₺₽₹₴₵₱₸₼₾⃁',
    ],
    'Miscellaneous': [
      ...'´¨¯˜ˆˇ˘˙˚˛˝¸',
      '◌̀', '◌́', '◌̂', '◌̃',
      '◌̄', '◌̆', '◌̇', '◌̈',
      '◌̉', '◌̊', '◌̋', '◌̌',
      '◌̛', '◌̣', '◌̤', '◌̥',
      '◌̦', '◌̧', '◌̨', '◌̩',
      '◌̮', '◌̰', '◌̱', '◌̲',
      '◌̶', '◌̸',
    ],
  }
  return { 'All': Object.values(groups).flat(), ...groups }
})()

// ── Style-specific glyph sets ────────────────────────────────────────────────
// Some glyphs exist in only one style. SBRomie keeps its 8 Private Use glyphs and
// the ss04 alternates in the italic, and the ss05 alternates in the roman — so the
// glyph-set tabs differ between roman and italic.
// NOTE: the ss04/ss05 character lists below are SBRomie's coverage; a fuller
// implementation would read the source glyphs from the font's GSUB.
const SS04_GLYPHS = [...'vwxz']  // italic-only stylistic set
const SS05_GLYPHS = [...'OQo']   // roman-only stylistic set
const PUA_CPS = [0xE901, 0xE902, 0xE903, 0xE904, 0xE905, 0xE906, 0xE907, 0xE908]
const PUA_GLYPHS = PUA_CPS.map(cp => String.fromCodePoint(cp)) // italic-only
const CURATED_GLYPH_SETS = new Set(['ss04', 'ss05', 'Private Use'])

// Which glyph-set tabs to show for the active style, given the font's capabilities.
function getGlyphSets(isItalic, features, hasPua) {
  const sets = { ...GLYPH_SETS }
  const styleHasPua = isItalic ? hasPua?.italic : hasPua?.roman
  if (styleHasPua) {
    // PUA glyphs are real codepoints, so fold them into "All" too.
    sets['All'] = [...GLYPH_SETS['All'], ...PUA_GLYPHS]
    sets['Private Use'] = PUA_GLYPHS
  }
  // ss04/ss05 are feature alternates of glyphs already in "All", so they stay in
  // their own forced-feature section rather than being folded in.
  if (isItalic) {
    if (features?.italic?.includes('ss04')) sets['ss04'] = SS04_GLYPHS
  } else {
    if (features?.roman?.includes('ss05')) sets['ss05'] = SS05_GLYPHS
  }
  return sets
}

// Minimal GSUB scan: returns the set of feature tags present (e.g. 'ss04').
function gsubFeatureTags(ab) {
  try {
    const d = new DataView(ab)
    const numTables = d.getUint16(4)
    let g = 0
    for (let i = 0; i < numTables; i++) {
      const t = String.fromCharCode(d.getUint8(12+i*16), d.getUint8(13+i*16), d.getUint8(14+i*16), d.getUint8(15+i*16))
      if (t === 'GSUB') { g = d.getUint32(12+i*16+8); break }
    }
    if (!g) return []
    const flOff = g + d.getUint16(g + 6)
    const count = d.getUint16(flOff)
    const tags = []
    for (let i = 0; i < count; i++) {
      const rec = flOff + 2 + i*6
      tags.push(String.fromCharCode(d.getUint8(rec), d.getUint8(rec+1), d.getUint8(rec+2), d.getUint8(rec+3)))
    }
    return tags
  } catch { return [] }
}

// ── TTC helpers ──────────────────────────────────────────────────────────────
function parseTTCOffsets(buffer) {
  const data = new DataView(buffer)
  const numFonts = data.getUint32(8)
  return Array.from({ length: numFonts }, (_, i) => data.getUint32(12 + i * 4))
}

function getFontNameInTTC(buffer, fontOffset) {
  const data = new DataView(buffer)
  const numTables = data.getUint16(fontOffset + 4)
  let nameOff = 0
  for (let i = 0; i < numTables; i++) {
    const r = fontOffset + 12 + i * 16
    const tag = String.fromCharCode(data.getUint8(r), data.getUint8(r+1), data.getUint8(r+2), data.getUint8(r+3))
    if (tag === 'name') { nameOff = data.getUint32(r + 8); break }
  }
  if (!nameOff) return null
  const count = data.getUint16(nameOff + 2)
  const base = nameOff + data.getUint16(nameOff + 4)
  for (const targetId of [4, 1]) {
    for (let i = 0; i < count; i++) {
      const r = nameOff + 6 + i * 12
      if (data.getUint16(r + 6) !== targetId) continue
      if (data.getUint16(r) === 3 && data.getUint16(r + 2) === 1) {
        const len = data.getUint16(r + 8), off = data.getUint16(r + 10)
        return Array.from({ length: len / 2 }, (_, j) => String.fromCharCode(data.getUint16(base + off + j * 2))).join('')
      }
    }
  }
  return null
}

// nameID priority: 16 (Preferred Family) → 1 (Family) → 4 (Full Name)
function readFamilyNameFromBuffer(buffer, fontOffset = 0) {
  try {
    const data = new DataView(buffer)
    const numTables = data.getUint16(fontOffset + 4)
    let nameOff = 0
    for (let i = 0; i < numTables; i++) {
      const r = fontOffset + 12 + i * 16
      const tag = String.fromCharCode(data.getUint8(r), data.getUint8(r+1), data.getUint8(r+2), data.getUint8(r+3))
      if (tag === 'name') { nameOff = data.getUint32(r + 8); break }
    }
    if (!nameOff) return null
    const count = data.getUint16(nameOff + 2)
    const base = nameOff + data.getUint16(nameOff + 4)
    for (const targetId of [16, 1, 4]) {
      for (let i = 0; i < count; i++) {
        const r = nameOff + 6 + i * 12
        if (data.getUint16(r + 6) !== targetId) continue
        if (data.getUint16(r) === 3 && data.getUint16(r + 2) === 1) {
          const len = data.getUint16(r + 8), off = data.getUint16(r + 10)
          return Array.from({ length: len / 2 }, (_, j) => String.fromCharCode(data.getUint16(base + off + j * 2))).join('')
        }
      }
    }
  } catch {}
  return null
}

function readVersionFromBuffer(buffer, fontOffset = 0) {
  try {
    const data = new DataView(buffer)
    const numTables = data.getUint16(fontOffset + 4)
    let nameOff = 0
    for (let i = 0; i < numTables; i++) {
      const r = fontOffset + 12 + i * 16
      const tag = String.fromCharCode(data.getUint8(r), data.getUint8(r+1), data.getUint8(r+2), data.getUint8(r+3))
      if (tag === 'name') { nameOff = data.getUint32(r + 8); break }
    }
    if (!nameOff) return null
    const count = data.getUint16(nameOff + 2)
    const base = nameOff + data.getUint16(nameOff + 4)
    for (let i = 0; i < count; i++) {
      const r = nameOff + 6 + i * 12
      if (data.getUint16(r + 6) !== 5) continue
      if (data.getUint16(r) === 3 && data.getUint16(r + 2) === 1) {
        const len = data.getUint16(r + 8), off = data.getUint16(r + 10)
        const str = Array.from({ length: len / 2 }, (_, j) => String.fromCharCode(data.getUint16(base + off + j * 2))).join('')
        return str.replace(/^Version\s+/i, '').trim()
      }
    }
  } catch {}
  return null
}

function extractFontFromTTC(buffer, fontOffset) {
  const data = new DataView(buffer)
  const src = new Uint8Array(buffer)
  const numTables = data.getUint16(fontOffset + 4)
  const tables = Array.from({ length: numTables }, (_, i) => {
    const r = fontOffset + 12 + i * 16
    return {
      tag: String.fromCharCode(data.getUint8(r), data.getUint8(r+1), data.getUint8(r+2), data.getUint8(r+3)),
      checksum: data.getUint32(r + 4),
      offset: data.getUint32(r + 8),
      length: data.getUint32(r + 12),
    }
  })
  const headerSize = 12 + numTables * 16
  let cursor = headerSize
  const newOffsets = tables.map(t => { const o = cursor; cursor = o + ((t.length + 3) & ~3); return o })
  const out = new Uint8Array(cursor)
  const outView = new DataView(out.buffer)
  outView.setUint32(0, data.getUint32(fontOffset))       // sfVersion
  outView.setUint16(4, numTables)
  outView.setUint16(6, data.getUint16(fontOffset + 6))   // searchRange
  outView.setUint16(8, data.getUint16(fontOffset + 8))   // entrySelector
  outView.setUint16(10, data.getUint16(fontOffset + 10)) // rangeShift
  tables.forEach((t, i) => {
    const r = 12 + i * 16
    t.tag.split('').forEach((c, j) => { out[r + j] = c.charCodeAt(0) })
    outView.setUint32(r + 4, t.checksum)
    outView.setUint32(r + 8, newOffsets[i])
    outView.setUint32(r + 12, t.length)
    out.set(src.subarray(t.offset, t.offset + t.length), newOffsets[i])
  })
  return out.buffer
}

// ── Slider row component ─────────────────────────────────────────────────────
function SliderRow({ label, tag, value, min, max, step, onChange, display, lockedAbove, allowAuto, autoValue }) {
  const lockedPct = lockedAbove != null
    ? Math.max(0, Math.min(100, (lockedAbove - min) / (max - min) * 100))
    : null
  const isAuto = allowAuto && value === 'auto'
  const hintShownRef = useRef(false)
  const [hintPos, setHintPos] = useState(null)
  const inputRef = useRef(null)
  const handleFocus = () => {
    if (allowAuto && !isAuto && !hintShownRef.current && inputRef.current) {
      hintShownRef.current = true
      const rect = inputRef.current.getBoundingClientRect()
      setHintPos({ top: rect.bottom + 6, left: rect.left })
      setTimeout(() => setHintPos(null), 3000)
    }
  }
  return (
    <div className="slider-row">
      {hintPos && createPortal(
        <div className="slider-auto-hint" style={{ top: hintPos.top, left: hintPos.left }}>
          hint: type "a" for auto
        </div>,
        document.body
      )}
      <div className="slider-label">
        <span className="slider-label-left">
          <span className={`slider-label-text${tag ? ' slider-label-text--tagged' : ''}`}>{label}</span>
          {tag && <span className="slider-tag">{tag}</span>}
        </span>
        <input
          ref={inputRef}
          className="slider-number"
          type={allowAuto ? 'text' : 'number'}
          inputMode={allowAuto ? 'numeric' : undefined}
          step={allowAuto ? undefined : step}
          value={allowAuto ? (display != null ? String(display).replace('-', '−') : value) : value}
          onFocus={handleFocus}
          onKeyDown={e => { if (allowAuto && e.key === 'a') { e.preventDefault(); onChange('auto') } }}
          onChange={e => {
            if (!allowAuto) { onChange(parseFloat(e.target.value)); return }
            const raw = String(e.target.value).replace('−', '-').trim()
            if (raw.toLowerCase() === 'auto') { onChange('auto'); return }
            onChange(parseFloat(raw))
          }}
        />
      </div>
      <div
        className="slider-track-wrap"
        style={lockedPct != null ? { '--locked-pct': `${lockedPct}%` } : undefined}
      >
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={isAuto ? Math.min(max, Math.max(min, autoValue ?? (min + max) / 2)) : value}
          onChange={e => onChange(parseFloat(e.target.value))}
        />
      </div>
    </div>
  )
}

// ── Mode button ──────────────────────────────────────────────────────────────
function ModeBtn({ active, onClick, children }) {
  return (
    <button className={`mode-btn ${active ? 'active' : ''}`} onClick={onClick}>
      {children}
    </button>
  )
}

// ── Main App ─────────────────────────────────────────────────────────────────
export default function App() {
  const { clientSlug, fontSlug } = parseRoute()
  const clientLabel = clientSlug ? toDisplayName(clientSlug) : null
  const isCalcom = clientSlug?.toLowerCase() === 'calcom'
  const calcomFontPrimary = 'calsans'
  const calcomFontPrimaryLabel = 'CalSans'

  // Font loading
  const [fontName, setFontName] = useState(null)
  const [fontVersion, setFontVersion] = useState(null)
  const [fontFace, setFontFace] = useState(null)
  const [italicFontFace, setItalicFontFace] = useState(null)
  const [isItalic, setIsItalic] = useState(false)
  // Stylistic-set toggles. ss04 substitutes italic-only glyphs; ss05 roman-only.
  const [ss04, setSs04] = useState(false)
  const [ss05, setSs05] = useState(false)
  // Static-family weight picker (null → default weight for the family)
  const [activeStyleKey, setActiveStyleKey] = useState(null)
  const [variationAxes, setVariationAxes] = useState([]) // [{tag, name, min, max, defaultVal}]
  const [axisValues, setAxisValues] = useState({})
  const [namedInstances, setNamedInstances] = useState([]) // [{name, coordinates: {tag: value}}]
  const [supportedRanges, setSupportedRanges] = useState(null) // [[start,end],...] cmap codepoint ranges, or null = show all
  const [glyphMatchUnavailable, setGlyphMatchUnavailable] = useState(false) // true when a compressed (woff/woff2) upload blocks glyph matching
  const [isDragging, setIsDragging] = useState(false)
  const [ttcFonts, setTtcFonts] = useState([])
  const [ttcIndex, setTtcIndex] = useState(0)
  const fontObjectUrl = useRef(null)
  const ttcBufferRef = useRef(null)
  const ttcOffsetsRef = useRef([])
  const fontFamilyRef = useRef('')

  // View mode
  const [mode, setMode] = useState(() => resolveInitialMode(isCalcom)) // 'big' | 'paragraph' | 'glyphs' | 'scale' | 'calcom' | 'coss'

  // Cal.com preview state
  const [calcomFont, setCalcomFont] = useState(calcomFontPrimary)
  const [calcomRoles, setCalcomRoles] = useState(DEFAULT_CALCOM_ROLES)
  const [activeCalcomRole, setActiveCalcomRole] = useState(null)

  // Coss (booking events) preview state
  const [cossRoles, setCossRoles] = useState(DEFAULT_COSS_ROLES)
  const [activeCossRole, setActiveCossRole] = useState(null)

  // Text content
  const [bigText, setBigText] = useState(SAMPLE_BIG)
  const [blocks, setBlocks] = useState(SAMPLE_BLOCKS)
  const [activeTextPreset, setActiveTextPreset] = useState('Sample')

  const [paraStyles, setParaStyles] = useState(DEFAULT_PARA_STYLES)

  // Paragraph styles panel
  const [paraStylesPanelOpen, setParaStylesPanelOpen] = useState(false)
  const [activeParaStyle, setActiveParaStyle] = useState(null)

  // Cal.com roles panel
  const [calcomPanelOpen, setCalcomPanelOpen] = useState(false)
  // Coss roles panel
  const [cossPanelOpen, setCossPanelOpen] = useState(false)

  // Mobile sidebar collapse
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(true)
  const [desktopSidebarOpen, setDesktopSidebarOpen] = useState(true)

  // Paragraph escape bar (right margin, px)
  const [rightMargin, setRightMargin] = useState(80)
  const rightMarginRef = useRef(80)
  useEffect(() => { rightMarginRef.current = rightMargin }, [rightMargin])

  // Max right margin: column can't get narrower than 45 'w' glyphs at paragraph size
  const maxRightMarginRef = useRef(80)
  useEffect(() => {
    if (!fontFace || !previewAreaRef.current) { maxRightMarginRef.current = 80; return }
    const canvas = document.createElement('canvas')
    const ctx = canvas.getContext('2d')
    ctx.font = `${paraStyles.p.size}px "${fontFace.family}"`
    const wWidth = ctx.measureText('w').width
    const areaWidth = previewAreaRef.current.clientWidth
    maxRightMarginRef.current = wWidth > 0
      ? Math.max(80, Math.round(areaWidth - 45 * wWidth))
      : 80
  }, [fontFace, paraStyles.p.size])

  // Scale base section escape bar
  const [scaleBaseMargin, setScaleBaseMargin] = useState(80)
  const scaleBaseMarginRef = useRef(80)
  useEffect(() => { scaleBaseMarginRef.current = scaleBaseMargin }, [scaleBaseMargin])
  const maxScaleBaseMarginRef = useRef(600)
  useEffect(() => {
    if (!previewAreaRef.current) return
    // Leave at least 200px of body column; account for 96px of preview-scale horizontal padding
    maxScaleBaseMarginRef.current = Math.max(80, previewAreaRef.current.clientWidth - 96 - 200)
  }, [fontFace])

  // Typography controls
  const [fontSize, setFontSize] = useState(200)
  const [letterSpacing, setLetterSpacing] = useState(0)
  const [lineHeight, setLineHeight] = useState(1.1)

  // Alignment
  const [textAlign, setTextAlign] = useState('left')

  // Glyph set selection
  const [activeGlyphSet, setActiveGlyphSet] = useState('Uppercase')
  // Per-style GSUB stylistic-set tags + whether the italic has the PUA glyphs
  const [glyphFeatures, setGlyphFeatures] = useState({ roman: [], italic: [] })
  const [hasPua, setHasPua] = useState({ roman: false, italic: false })

  // Parsed PS family name for scale label default
  const [fontFamilyLabel, setFontFamilyLabel] = useState('')

  // Scale mode state
  const [scaleMaxXl, setScaleMaxXl] = useState(9)
  const [scalePairSizes, setScalePairSizes] = useState(new Set()) // active body pair sizes
  const [scaleLabelText, setScaleLabelText] = useState('')
  const [scalePairText, setScalePairText] = useState(SCALE_PAIR_TEXT)
  const [scaleAxisOverrides, setScaleAxisOverrides] = useState(() => ({ ...DEFAULT_SCALE_AXIS_OVERRIDES }))
  const [activeScaleStep, setActiveScaleStep] = useState(null)
  const [scaleStepRangeEnd, setScaleStepRangeEnd] = useState(null)
  const [extraScaleSteps, setExtraScaleSteps] = useState(new Set())
  const [scaleMultiSelectMode, setScaleMultiSelectMode] = useState(false)
  const [scaleStepsPanelOpen, setScaleStepsPanelOpen] = useState(false)

  const dragCounterRef = useRef(0)
  const fileInputRef = useRef(null)
  const previewAreaRef = useRef(null)
  const bigEditorRef = useRef(null)
  const blockRefs = useRef({})
  // Which paragraph block is being edited. Focused → contentEditable owns the raw
  // markup text; blurred → we render *italic* / **bold** as styled spans.
  const [focusedBlockId, setFocusedBlockId] = useState(null)
  const pendingBlockCaret = useRef(null)
  const stylesPanelBtnRef = useRef(null)
  const mobileStylesBtnRef = useRef(null)
  const stylesPanelPopoverRef = useRef(null)
  const calcomPanelBtnRef = useRef(null)
  const calcomPanelPopoverRef = useRef(null)
  const cossPanelBtnRef = useRef(null)
  const cossPanelPopoverRef = useRef(null)
  const scaleRowRefs = useRef({})
  const scalePairRefs = useRef({})
  const scalePanelBtnRef = useRef(null)
  const scalePanelPopoverRef = useRef(null)

  const bigEditorCallback = useCallback(el => {
    bigEditorRef.current = el
    if (el && !el.textContent) el.textContent = SAMPLE_BIG
  }, [])

  // ── Sync URL hash with active mode ───────────────────────────────────────
  useEffect(() => {
    const hash = MODE_TO_HASH[mode]
    if (hash) window.history.replaceState(null, null, window.location.pathname + hash)
  }, [mode])

  // ── Sync scale label text with parsed PS family name ─────────────────────
  useEffect(() => {
    setScaleLabelText(fontFamilyLabel)
    Object.values(scaleRowRefs.current).forEach(el => { if (el) el.textContent = fontFamilyLabel })
  }, [fontFamilyLabel])

  // ── Auto-fit font size to preview width ────────────────────────────────────
  const autoFitSize = useCallback((fontFamily) => {
    if (window.innerWidth > 768) return
    const area = previewAreaRef.current
    if (!area) return
    const availWidth = area.clientWidth - 128
    if (!availWidth) return
    const span = document.createElement('span')
    span.style.cssText = `position:absolute;visibility:hidden;white-space:nowrap;font-family:"${fontFamily}";font-size:100px`
    span.textContent = 'gloves'
    document.body.appendChild(span)
    const w = span.offsetWidth
    document.body.removeChild(span)
    if (!w) return
    setFontSize(Math.min(400, Math.max(20, Math.floor(100 * availWidth / w))))
  }, [])

  // Static-family weight list for the current route (empty for single/variable fonts)
  const familyStyles = useMemo(
    () => (fontSlug && !matchSpecial(fontSlug)) ? getFamilyStyles(fontSlug) : [],
    [fontSlug]
  )
  const isFamily = familyStyles.length >= 2
  const currentStyleKey = isFamily ? (activeStyleKey ?? defaultStyleKey(familyStyles)) : null

  // Per-block weight support: load every family weight under its own font-family
  // (roman + italic), so different paragraph blocks can show different weights.
  const [weightFamilies, setWeightFamilies] = useState({}) // { weightKey: cssFamilyName }
  useEffect(() => {
    if (!isFamily) { setWeightFamilies({}); return }
    let cancelled = false
    const nameBase = fontSlug.replace(/\s+/g, '')
    ;(async () => {
      const fams = {}
      for (const st of familyStyles) {
        const famName = `${nameBase}_${st.key}Preview`
        try {
          if (st.roman) { const f = new FontFace(famName, `url(${st.roman.url})`); await f.load(); document.fonts.add(f) }
          if (st.italic) { const f = new FontFace(famName, `url(${st.italic.url})`, { style: 'italic' }); await f.load(); document.fonts.add(f) }
          fams[st.key] = famName
        } catch { /* skip a weight that fails to load */ }
      }
      if (!cancelled) setWeightFamilies(fams)
    })()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fontSlug, isFamily])

  // ── Auto-load font from URL route ──────────────────────────────────────────
  useEffect(() => {
    if (!fontSlug) return

    const special = matchSpecial(fontSlug)
    let matched, italicMatch, resolvedSlug
    if (special?.file) {
      const entry = Object.entries(fontModules).find(([path]) => path.endsWith('/' + special.file))
      matched = entry ? { url: entry[1], filename: special.file } : null
      italicMatch = null
      resolvedSlug = fontSlug
    } else if (isFamily) {
      // Static family: pick the roman + italic files for the selected weight.
      const st = familyStyles.find(s => s.key === currentStyleKey) ?? familyStyles[0]
      matched = st.roman ?? st.italic
      italicMatch = st.italic
      resolvedSlug = fontSlug
    } else {
      resolvedSlug = special ? 'calsans' : fontSlug
      matched = matchFont(resolvedSlug)
      italicMatch = matchItalicFont(resolvedSlug)
    }
    if (!matched) return

    const loadRouteFont = async () => {
      // Families keep a constant family name across weights, so switching style
      // just re-points the same CSS font-family.
      const baseName = special ? special.name
        : isFamily ? fontSlug
        : matched.filename.replace(/\.[^/.]+$/, '').replace(/\s*[\[(].*$/g, '').trim()
      const name = `${baseName.replace(/\s+/g, '')}Preview` // space-free: Chrome quotes multi-word FontFace.family, which then double-quotes in CSS and gets dropped

      // Load roman face
      const face = new FontFace(name, `url(${matched.url})`)
      const loaded = await face.load()
      document.fonts.add(loaded)
      setFontFace(loaded)
      setFontName(matched.filename.replace(/\.[^/.]+$/, ''))
      autoFitSize(name)

      // Parse PS family name, version, and GSUB stylistic-set tags (roman)
      fetch(matched.url).then(r => r.arrayBuffer()).then(buf => {
        setFontFamilyLabel(readFamilyNameFromBuffer(buf) ?? special?.name ?? baseName)
        setFontVersion(readVersionFromBuffer(buf))
        setGlyphFeatures(prev => ({ ...prev, roman: gsubFeatureTags(buf) }))
      }).catch(() => { setFontFamilyLabel(special?.name ?? baseName); setFontVersion(null) })

      // Does this file's cmap contain all the Private Use glyphs?
      const hasPuaGlyphs = (fname) => {
        const c = fontAxesData[fname]?.chars
        return !!c && PUA_CPS.every(cp => c.some(([a, b]) => cp >= a && cp <= b))
      }

      // Load italic companion (registers under same family with style:'italic')
      if (italicMatch) {
        const italicFace = new FontFace(name, `url(${italicMatch.url})`, { style: 'italic' })
        const loadedItalic = await italicFace.load()
        document.fonts.add(loadedItalic)
        setItalicFontFace(loadedItalic)
        // Detect the italic's stylistic sets for the glyph tabs
        fetch(italicMatch.url).then(r => r.arrayBuffer())
          .then(buf => setGlyphFeatures(prev => ({ ...prev, italic: gsubFeatureTags(buf) })))
          .catch(() => {})
        setHasPua({ roman: hasPuaGlyphs(matched.filename), italic: hasPuaGlyphs(italicMatch.filename) })
      } else {
        setItalicFontFace(null)
        setIsItalic(false)
        setGlyphFeatures(prev => ({ ...prev, italic: [] }))
        setHasPua({ roman: hasPuaGlyphs(matched.filename), italic: false })
      }

      // Axes + instances from virtual module (covers TTF and woff2)
      const { axes, instances, chars } = fontAxesData[matched.filename] ?? { axes: [], instances: [] }
      setVariationAxes(axes)
      setNamedInstances(instances)
      setSupportedRanges(chars ?? null)
      setGlyphMatchUnavailable(false)
      const defaults = {}
      axes.forEach(a => { defaults[a.tag] = a.defaultVal })
      setAxisValues(defaults)
    }
    loadRouteFont().catch(console.error)
  }, [fontSlug, currentStyleKey])


  // ── Font loading ───────────────────────────────────────────────────────────
  const loadFont = useCallback(async (file) => {
    try {
      if (fontObjectUrl.current) URL.revokeObjectURL(fontObjectUrl.current)

      const buffer = await file.arrayBuffer()
      const isTTC = new DataView(buffer).getUint32(0) === 0x74746366

      const baseName = file.name.replace(/\.[^/.]+$/, '').replace(/\s*[\[(].*$/g, '').trim()
      const name = `${baseName.replace(/\s+/g, '')}Preview` // space-free: Chrome quotes multi-word FontFace.family, which then double-quotes in CSS and gets dropped
      fontFamilyRef.current = name

      if (isTTC) {
        const offsets = parseTTCOffsets(buffer)
        const fonts = offsets.map((off, i) => getFontNameInTTC(buffer, off) || `Font ${i + 1}`)
        ttcBufferRef.current = buffer
        ttcOffsetsRef.current = offsets
        setTtcFonts(fonts)
        setTtcIndex(0)
        const extracted = extractFontFromTTC(buffer, offsets[0])
        const url = URL.createObjectURL(new Blob([extracted], { type: 'font/ttf' }))
        fontObjectUrl.current = url
        const face = new FontFace(name, `url(${url})`)
        const loaded = await face.load()
        document.fonts.add(loaded)
        setFontFace(loaded)
        setFontName(file.name.replace(/\.[^/.]+$/, ''))
        setFontFamilyLabel(readFamilyNameFromBuffer(buffer, offsets[0]) ?? baseName)
        setFontVersion(readVersionFromBuffer(buffer, offsets[0]))
        autoFitSize(name)
        await detectAxes(new File([extracted], 'extracted.ttf'))
      } else {
        ttcBufferRef.current = null
        ttcOffsetsRef.current = []
        setTtcFonts([])
        setTtcIndex(0)
        const url = URL.createObjectURL(file)
        fontObjectUrl.current = url
        const face = new FontFace(name, `url(${url})`)
        const loaded = await face.load()
        document.fonts.add(loaded)
        setFontFace(loaded)
        setFontName(file.name.replace(/\.[^/.]+$/, ''))
        setFontFamilyLabel(readFamilyNameFromBuffer(buffer) ?? baseName)
        setFontVersion(readVersionFromBuffer(buffer))
        autoFitSize(name)
        await detectAxes(file)
      }
    } catch (err) {
      console.error('Font load error', err)
    }
  }, [autoFitSize])

  const selectTTCFont = useCallback(async (index) => {
    try {
      const buffer = ttcBufferRef.current
      const offsets = ttcOffsetsRef.current
      if (!buffer || !offsets[index]) return
      if (fontObjectUrl.current) URL.revokeObjectURL(fontObjectUrl.current)
      const extracted = extractFontFromTTC(buffer, offsets[index])
      const url = URL.createObjectURL(new Blob([extracted], { type: 'font/ttf' }))
      fontObjectUrl.current = url
      const face = new FontFace(fontFamilyRef.current, `url(${url})`)
      const loaded = await face.load()
      document.fonts.add(loaded)
      setFontFace(loaded)
      setTtcIndex(index)
      const familyName = readFamilyNameFromBuffer(buffer, offsets[index])
      if (familyName) setFontFamilyLabel(familyName)
      setFontVersion(readVersionFromBuffer(buffer, offsets[index]))
      await detectAxes(new File([extracted], 'extracted.ttf'))
    } catch (err) {
      console.error('TTC font switch error', err)
    }
  }, [])

  const detectAxes = async (file) => {
    setSupportedRanges(null)
    setGlyphMatchUnavailable(false)
    // Try virtual module first (covers all font formats including woff2)
    const known = fontAxesData[file.name]
    if (known) {
      setVariationAxes(known.axes)
      setNamedInstances(known.instances)
      setSupportedRanges(known.chars ?? null)
      const defaults = {}
      known.axes.forEach(a => { defaults[a.tag] = a.defaultVal })
      setAxisValues(defaults)
      return
    }
    // Fallback: parse TTF/OTF inline (woff2 will return empty)
    try {
      const buffer = await file.arrayBuffer()
      const data = new DataView(buffer)
      const sig = data.getUint32(0)
      if (sig === 0x774F4646 || sig === 0x774F4632) { setVariationAxes([]); setNamedInstances([]); setAxisValues({}); setGlyphMatchUnavailable(true); return }
      setSupportedRanges(parseCmapRanges(buffer))
      const numTables = data.getUint16(4)
      let fvarOffset = 0, nameOffset = 0
      for (let i = 0; i < numTables; i++) {
        const t = String.fromCharCode(data.getUint8(12+i*16), data.getUint8(13+i*16), data.getUint8(14+i*16), data.getUint8(15+i*16))
        if (t === 'fvar') fvarOffset = data.getUint32(12+i*16+8)
        if (t === 'name') nameOffset = data.getUint32(12+i*16+8)
      }
      if (!fvarOffset) { setVariationAxes([]); setNamedInstances([]); setAxisValues({}); return }
      const getStr = (id) => {
        if (!nameOffset) return null
        const count = data.getUint16(nameOffset+2), base = nameOffset+data.getUint16(nameOffset+4)
        for (let i = 0; i < count; i++) {
          const r = nameOffset+6+i*12
          if (data.getUint16(r+6) !== id) continue
          if (data.getUint16(r) === 3 && data.getUint16(r+2) === 1) {
            const len = data.getUint16(r+8), off = data.getUint16(r+10)
            return Array.from({length:len/2}, (_,j) => String.fromCharCode(data.getUint16(base+off+j*2))).join('')
          }
        }
        return null
      }
      const tagLabels = { wght:'Weight', wdth:'Width', ital:'Italic', slnt:'Slant', opsz:'Optical Size', GRAD:'Grade' }
      const axOff=data.getUint16(fvarOffset+4), axCnt=data.getUint16(fvarOffset+8), axSz=data.getUint16(fvarOffset+10)
      const instCnt=data.getUint16(fvarOffset+12), instSz=data.getUint16(fvarOffset+14)
      const tags=[], axes=[]
      for (let i=0; i<axCnt; i++) {
        const o=fvarOffset+axOff+i*axSz, tag=String.fromCharCode(data.getUint8(o),data.getUint8(o+1),data.getUint8(o+2),data.getUint8(o+3))
        tags.push(tag)
        axes.push({ tag, name: getStr(data.getUint16(o+18)) || tagLabels[tag] || tag, min: data.getInt32(o+4)/65536, max: data.getInt32(o+12)/65536, defaultVal: data.getInt32(o+8)/65536 })
      }
      const instStart=fvarOffset+axOff+axCnt*axSz, instances=[]
      for (let i=0; i<instCnt; i++) {
        const o=instStart+i*instSz, name=getStr(data.getUint16(o))
        if (!name) continue
        const coords={}; tags.forEach((t,j) => { coords[t]=data.getInt32(o+4+j*4)/65536 })
        instances.push({ name, coordinates: coords })
      }
      setVariationAxes(axes); setNamedInstances(instances)
      const defaults={}; axes.forEach(a => { defaults[a.tag]=a.defaultVal }); setAxisValues(defaults)
    } catch { setVariationAxes([]); setNamedInstances([]); setAxisValues({}) }
  }

  // ── Drop zone ──────────────────────────────────────────────────────────────
  const handleDrop = useCallback((e) => {
    e.preventDefault()
    dragCounterRef.current = 0
    setIsDragging(false)
    const file = e.dataTransfer.files[0]
    if (file) loadFont(file)
  }, [loadFont])

  const handleDragEnter = useCallback((e) => { e.preventDefault(); dragCounterRef.current++; setIsDragging(true) }, [])
  const handleDragOver  = useCallback((e) => { e.preventDefault() }, [])
  const handleDragLeave = useCallback(() => { if (--dragCounterRef.current <= 0) { dragCounterRef.current = 0; setIsDragging(false) } }, [])

  useEffect(() => {
    window.addEventListener('dragenter', handleDragEnter)
    window.addEventListener('dragover',  handleDragOver)
    window.addEventListener('dragleave', handleDragLeave)
    window.addEventListener('drop', handleDrop)
    return () => {
      window.removeEventListener('dragenter', handleDragEnter)
      window.removeEventListener('dragover',  handleDragOver)
      window.removeEventListener('dragleave', handleDragLeave)
      window.removeEventListener('drop', handleDrop)
    }
  }, [handleDragEnter, handleDragOver, handleDragLeave, handleDrop])
  // ── Font variation string ─────────────────────────────────────────────────
  const fontVariationSettings = Object.entries(axisValues)
    .filter(([, val]) => val !== 'auto')
    .map(([tag, val]) => `"${tag}" ${val}`)
    .join(', ') || 'normal'

  const fontStyle = isItalic && italicFontFace ? 'italic' : 'normal'

  // Shared feature string for the proofing text. ss04 only fires in italic, ss05
  // only in roman — matching each stylistic set's glyph coverage.
  const proofFeatureSettings = featureStr(isItalic, ss04, ss05)

  // Style-aware glyph sets for the Glyphs view (roman vs italic differ)
  const glyphSets = getGlyphSets(isItalic, glyphFeatures, hasPua)
  const activeGlyphKey = glyphSets[activeGlyphSet] ? activeGlyphSet : 'All'
  // Reset the tab when the active set disappears (e.g. after a roman/italic switch)
  useEffect(() => {
    if (!glyphSets[activeGlyphSet]) setActiveGlyphSet('All')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isItalic, glyphFeatures, hasPua])

  const previewStyle = {
    fontFamily: fontFace ? `"${fontFace.family}"` : 'serif',
    fontStyle,
    fontSize: `${fontSize}px`,
    letterSpacing: `${letterSpacing}em`,
    lineHeight: lineHeight,
    fontVariationSettings,
    fontOpticalSizing: axisValues['opsz'] === 'auto' ? 'auto' : 'none',
    fontSynthesis: 'none',
    fontFeatureSettings: proofFeatureSettings,
    textAlign,
    color: 'var(--text)',
    wordBreak: 'break-word',
    transition: 'font-variation-settings 0.15s ease',
  }

  // ── Active style for sidebar controls in paragraph/scale mode ────────────
  const effectiveParaStyle = mode === 'paragraph'
    ? (activeParaStyle ?? 'p')
    : mode === 'scale'
    ? activeParaStyle   // null unless user picks one from the dropdown
    : null

  // Weight / Roman-Italic / ss04 / ss05 scope to the selected block (P by default
  // in paragraph mode); with no block selected they edit the global control.
  const styleScope = effectiveParaStyle
  const scopedWeight = styleScope ? (paraStyles[styleScope].weight ?? currentStyleKey) : currentStyleKey
  const scopedItalic = styleScope ? (paraStyles[styleScope].italic ?? isItalic) : isItalic
  const scopedSs04 = styleScope ? (paraStyles[styleScope].ss04 ?? ss04) : ss04
  const scopedSs05 = styleScope ? (paraStyles[styleScope].ss05 ?? ss05) : ss05
  const setScopedField = (field, value) =>
    setParaStyles(prev => ({ ...prev, [styleScope]: { ...prev[styleScope], [field]: value } }))
  const setScopedWeight = (v) => styleScope ? setScopedField('weight', v) : setActiveStyleKey(v)
  const setScopedItalic = (v) => styleScope ? setScopedField('italic', v) : setIsItalic(v)
  const toggleScopedSs04 = () => styleScope ? setScopedField('ss04', !scopedSs04) : setSs04(v => !v)
  const toggleScopedSs05 = () => styleScope ? setScopedField('ss05', !scopedSs05) : setSs05(v => !v)

  // ── Active role for calcom mode ───────────────────────────────────────────
  const effectiveCalcomRole = mode === 'calcom' ? activeCalcomRole : null
  const effectiveCossRole = mode === 'coss' ? activeCossRole : null
  const effectiveScaleStep = mode === 'scale' ? activeScaleStep : null
  const selectedScaleSteps = useMemo(() => {
    if (!effectiveScaleStep) return []
    const keys = TAILWIND_SCALE.map(s => s.key)
    const rangeKeys = (() => {
      if (!scaleStepRangeEnd) return [effectiveScaleStep]
      const a = keys.indexOf(effectiveScaleStep), b = keys.indexOf(scaleStepRangeEnd)
      return keys.slice(...(a < b ? [a, b + 1] : [b, a + 1]))
    })()
    const all = new Set([...rangeKeys, ...extraScaleSteps])
    return keys.filter(k => all.has(k))
  }, [effectiveScaleStep, scaleStepRangeEnd, extraScaleSteps])

  const roleStyle = (role) => {
    const r = calcomRoles[role] ?? calcomRoles.eventDesc
    const merged = { ...axisValues, ...r.axisOverrides }
    const fvs = Object.entries(merged).filter(([, v]) => v !== 'auto').map(([t, v]) => `"${t}" ${v}`).join(', ') || 'normal'
    const opszAuto = merged['opsz'] === 'auto'
    if (role === 'eventTitle' && calcomFont !== 'calsans') {
      return {
        fontFamily: "'CalSansBold', sans-serif",
        fontSize: `${r.size}px`,
        letterSpacing: `${r.interTracking ?? r.tracking}em`,
        lineHeight: r.leading,
        fontVariationSettings: 'normal',
        fontOpticalSizing: 'none',
        fontSynthesis: 'none',
        fontFeatureSettings: 'normal',
      }
    }
    const family = calcomFont === 'calsans'
      ? (fontFace ? `"${fontFace.family}"` : '"Inter", system-ui, sans-serif')
      : calcomFont === 'calsans'
        ? '"CalSans"'
        : '"Inter", system-ui, -apple-system, sans-serif'
    return {
      fontFamily: family,
      fontSize: `${r.size}px`,
      letterSpacing: `${r.tracking}em`,
      lineHeight: r.leading,
      fontVariationSettings: (calcomFont === 'calsans') ? fvs : 'normal',
      fontOpticalSizing: (calcomFont === 'calsans') && opszAuto ? 'auto' : 'none',
      fontSynthesis: 'none',
      fontFeatureSettings: '"calt" 0, "liga" 0, "ss20" 0',
    }
  }

  const cossRoleStyle = (role) => {
    const r = cossRoles[role] ?? cossRoles.cardDesc
    const merged = { ...axisValues, ...r.axisOverrides }
    const fvs = Object.entries(merged).filter(([, v]) => v !== 'auto').map(([t, v]) => `"${t}" ${v}`).join(', ') || 'normal'
    const opszAuto = merged['opsz'] === 'auto'
    if (role === 'pageTitle' && calcomFont !== 'calsans') {
      return {
        fontFamily: "'CalSansBold', sans-serif",
        fontSize: `${r.size}px`,
        letterSpacing: `${r.tracking}em`,
        lineHeight: r.leading,
        fontVariationSettings: 'normal',
        fontOpticalSizing: 'none',
        fontSynthesis: 'none',
        fontFeatureSettings: 'normal',
      }
    }
    const family = calcomFont === 'calsans'
      ? (fontFace ? `"${fontFace.family}"` : '"Inter", system-ui, sans-serif')
      : calcomFont === 'calsans'
        ? '"CalSans"'
        : '"Inter", system-ui, -apple-system, sans-serif'
    return {
      fontFamily: family,
      fontSize: `${r.size}px`,
      letterSpacing: `${r.tracking}em`,
      lineHeight: r.leading,
      fontVariationSettings: (calcomFont === 'calsans') ? fvs : 'normal',
      fontOpticalSizing: (calcomFont === 'calsans') && opszAuto ? 'auto' : 'none',
      fontSynthesis: 'none',
      fontFeatureSettings: '"calt" 0, "liga" 0, "ss20" 0',
    }
  }

  // ── Paragraph comfortable max (scales 48→400 as escape bar opens 80→10px) ──
  const paraComfortableMax = Math.max(18, Math.round(48 + Math.max(0, 80 - rightMargin) * 5))

  // Reactively clamp p size when column narrows
  useEffect(() => {
    setParaStyles(prev => {
      if (prev.p.size <= paraComfortableMax) return prev
      return { ...prev, p: { ...prev.p, size: paraComfortableMax } }
    })
  }, [paraComfortableMax])

  const handleEscapeBarMouseDown = useCallback((e) => {
    e.preventDefault()
    const startX = e.clientX
    const startMargin = rightMarginRef.current
    const onMove = (e) => {
      // drag right → smaller margin → wider column → higher max
      const newMargin = Math.max(10, Math.min(maxRightMarginRef.current, startMargin - (e.clientX - startX)))
      setRightMargin(newMargin)
    }
    const onUp = () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }, [])

  const handleScaleEscapeBarMouseDown = useCallback((e) => {
    e.preventDefault()
    document.body.style.userSelect = 'none'
    const startX = e.touches ? e.touches[0].clientX : e.clientX
    const startMargin = scaleBaseMarginRef.current
    const onMove = (e) => {
      if (e.cancelable) e.preventDefault()
      const x = e.touches ? e.touches[0].clientX : e.clientX
      setScaleBaseMargin(Math.max(10, Math.min(maxScaleBaseMarginRef.current, startMargin - (x - startX))))
    }
    const onUp = () => {
      document.body.style.userSelect = ''
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      window.removeEventListener('touchmove', onMove)
      window.removeEventListener('touchend', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    window.addEventListener('touchmove', onMove, { passive: false })
    window.addEventListener('touchend', onUp)
  }, [])

  // Clamp base step font size to maintain ~60 chars/line at current column width
  const scaleBaseClampPx = useMemo(() => {
    if (!previewAreaRef.current) return null
    const colWidth = previewAreaRef.current.clientWidth - scaleBaseMargin
    return Math.max(8, colWidth / 24)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scaleBaseMargin])

  // ── Per-block style (paragraph mode) ─────────────────────────────────────
  const blockStyle = (type) => {
    const s = paraStyles[type] ?? paraStyles.p
    const merged = { ...axisValues, ...s.axisOverrides }
    const fvs = Object.entries(merged).filter(([, v]) => v !== 'auto').map(([t, v]) => `"${t}" ${v}`).join(', ') || 'normal'
    // Per-block weight/italic/ss resolve to the block's override, or the global control.
    const weight = s.weight ?? currentStyleKey
    const italic = s.italic ?? isItalic
    const s04 = s.ss04 ?? ss04
    const s05 = s.ss05 ?? ss05
    const family = (weight && weightFamilies[weight]) ? `"${weightFamilies[weight]}"` : (fontFace ? `"${fontFace.family}"` : 'serif')
    return {
      fontFamily: family,
      fontStyle: (italic && (isFamily || italicFontFace)) ? 'italic' : 'normal',
      fontSize: `${s.size}px`,
      letterSpacing: `${s.tracking}em`,
      lineHeight: s.leading,
      fontVariationSettings: fvs,
      fontOpticalSizing: merged['opsz'] === 'auto' ? 'auto' : 'none',
      fontSynthesis: 'none',
      fontFeatureSettings: featureStr(italic, s04, s05),
      textAlign,
      color: 'var(--text)',
      wordBreak: 'break-word',
      display: 'block',
      width: '100%',
      minHeight: '1em',
      outline: 'none',
      cursor: 'text',
      transition: 'font-variation-settings 0.15s ease',
    }
  }

  // Style for an inline *italic* / **bold** span. Resolves through the same
  // face/axis logic as blockStyle, so each deployment's font renders its own
  // italic (variable axis OR separate face) and bold (weight family OR wght).
  // Only font-varying props are set; size/leading/tracking inherit from the block.
  const inlineStyle = (type, kind) => {
    const s = paraStyles[type] ?? paraStyles.p
    const s04 = s.ss04 ?? ss04
    const s05 = s.ss05 ?? ss05
    const italic = kind === 'italic' ? true : (s.italic ?? isItalic)
    let weight = s.weight ?? currentStyleKey
    const merged = { ...axisValues, ...s.axisOverrides }
    if (kind === 'italic') {
      // Variable italic: drive the font's own axis (Cal Sans 'ital', or a 'slnt'
      // slant). Fonts whose italic is a separate face fall through to fontStyle below.
      const italAx = variationAxes.find(a => a.tag === 'ital')
      const slntAx = variationAxes.find(a => a.tag === 'slnt')
      if (italAx) merged.ital = italAx.max
      else if (slntAx) merged.slnt = slntAx.min
    }
    if (kind === 'bold') {
      const boldKey = Object.keys(weightFamilies).find(k => /bold|black|heavy|semibold|700|800|900/i.test(k))
      if (boldKey) weight = boldKey
      else {
        const wghtAx = variationAxes.find(a => a.tag === 'wght')
        if (wghtAx) merged.wght = Math.min(wghtAx.max, 700)
      }
    }
    const family = (weight && weightFamilies[weight]) ? `"${weightFamilies[weight]}"` : (fontFace ? `"${fontFace.family}"` : 'serif')
    const fvs = Object.entries(merged).filter(([, v]) => v !== 'auto').map(([t, v]) => `"${t}" ${v}`).join(', ') || 'normal'
    return {
      fontFamily: family,
      fontStyle: (italic && (isFamily || italicFontFace)) ? 'italic' : 'normal',
      fontVariationSettings: fvs,
      fontFeatureSettings: featureStr(italic, s04, s05),
      fontSynthesis: 'none',
    }
  }

  // ── Scale mode helpers ────────────────────────────────────────────────────
  const scaleStepStyle = (step, effectivePxSize) => {
    const overrides = scaleAxisOverrides[step.key] ?? { opsz: 'auto' }
    const merged = { opsz: 'auto', ...axisValues, ...overrides }
    const fvs = Object.entries(merged).filter(([, v]) => v !== 'auto').map(([t, v]) => `"${t}" ${v}`).join(', ') || 'normal'
    return {
      fontFamily: fontFace ? `"${fontFace.family}"` : 'serif',
      fontStyle,
      fontSize: `${effectivePxSize ?? step.pxSize}px`,
      lineHeight: step.lh,
      letterSpacing: 0,
      fontVariationSettings: fvs,
      fontOpticalSizing: merged.opsz === 'auto' ? 'auto' : 'none',
      fontSynthesis: 'none',
      fontFeatureSettings: proofFeatureSettings,
      color: 'var(--text)',
      transition: 'font-variation-settings 0.15s ease',
    }
  }

  const visibleScaleSteps = [
    ...TAILWIND_XL.slice(0, scaleMaxXl).reverse(),
    ...[...TAILWIND_BASE].reverse(),
  ]

  // Descending (lg → xs), matching the button order in the sidebar
  const scalePairSteps = [...TAILWIND_SCALE].filter(s => scalePairSizes.has(s.key)).reverse()

  const handleScaleLabelInput = useCallback((key, e) => {
    const text = e.currentTarget.textContent
    setScaleLabelText(text)
    Object.entries(scaleRowRefs.current).forEach(([k, el]) => {
      if (k !== key && el) el.textContent = text
    })
  }, [])

  const handleScalePairInput = useCallback((key, e) => {
    const text = e.currentTarget.textContent
    setScalePairText(text)
    Object.entries(scalePairRefs.current).forEach(([k, el]) => {
      if (k !== key && el) el.textContent = text
    })
  }, [])

  const handleBlockInput = useCallback((id, e) => {
    const text = e.currentTarget.textContent
    setBlocks(prev => prev.map(b => b.id === id ? { ...b, text } : b))
  }, [])

  const handleBlockKeyDown = useCallback((id, e) => {
    if (e.key === ' ') {
      const el = blockRefs.current[id]
      const text = el?.textContent ?? ''
      const mdType = text === '#' ? 'h1' : text === '##' ? 'h2' : text === '###' ? 'h3' : null
      if (mdType) {
        e.preventDefault()
        el.textContent = ''
        setBlocks(prev => prev.map(b => b.id === id ? { ...b, type: mdType, text: '' } : b))
        requestAnimationFrame(() => { el.focus(); placeCursorAtStart(el) })
      }
    }
    if (e.key === 'Enter') {
      e.preventDefault()
      const newId = String(Date.now())
      setBlocks(prev => {
        const idx = prev.findIndex(b => b.id === id)
        const next = [...prev]
        next.splice(idx + 1, 0, { id: newId, type: 'p', text: '' })
        return next
      })
      requestAnimationFrame(() => {
        const el = blockRefs.current[newId]
        if (el) { el.focus(); placeCursorAtStart(el) }
      })
    }
    if (e.key === 'Backspace') {
      const el = blockRefs.current[id]
      if (el && !el.textContent) {
        e.preventDefault()
        setBlocks(prev => {
          if (prev.length <= 1) return prev
          const idx = prev.findIndex(b => b.id === id)
          const next = prev.filter(b => b.id !== id)
          const targetId = next[Math.max(0, idx - 1)]?.id
          requestAnimationFrame(() => {
            const targetEl = blockRefs.current[targetId]
            if (targetEl) { targetEl.focus(); placeCursorAtEnd(targetEl) }
          })
          return next
        })
      }
    }
  }, [])

  // On focusing a block, the styled spans collapse to raw markup text; restore the
  // caret to where the user clicked (captured on mousedown against the styled content).
  useLayoutEffect(() => {
    if (focusedBlockId && pendingBlockCaret.current?.id === focusedBlockId) {
      const el = blockRefs.current[focusedBlockId]
      if (el) placeCursorAtOffset(el, pendingBlockCaret.current.offset)
    }
    pendingBlockCaret.current = null
  }, [focusedBlockId])

  // ── Close styles popover on outside click ──────────────────────────────────
  useEffect(() => {
    if (!paraStylesPanelOpen) return
    const handler = (e) => {
      if (
        stylesPanelBtnRef.current?.contains(e.target) ||
        mobileStylesBtnRef.current?.contains(e.target) ||
        stylesPanelPopoverRef.current?.contains(e.target)
      ) return
      setParaStylesPanelOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [paraStylesPanelOpen])

  useEffect(() => {
    if (!calcomPanelOpen) return
    const handler = (e) => {
      if (
        calcomPanelBtnRef.current?.contains(e.target) ||
        calcomPanelPopoverRef.current?.contains(e.target)
      ) return
      setCalcomPanelOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [calcomPanelOpen])

  useEffect(() => {
    if (!cossPanelOpen) return
    const handler = (e) => {
      if (
        cossPanelBtnRef.current?.contains(e.target) ||
        cossPanelPopoverRef.current?.contains(e.target)
      ) return
      setCossPanelOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [cossPanelOpen])

  useEffect(() => {
    if (!scaleStepsPanelOpen) return
    const handler = (e) => {
      if (
        scalePanelBtnRef.current?.contains(e.target) ||
        scalePanelPopoverRef.current?.contains(e.target)
      ) return
      setScaleStepsPanelOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [scaleStepsPanelOpen])

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div
      className={`layout ${isDragging ? 'dragging' : ''}`}
    >
      <ThemeToggle />
      {/* Drop overlay */}
      {isDragging && (
        <div className="drop-overlay">
          <div className="drop-overlay-inner">
            <span className="drop-icon">↓</span>
            <span>Drop font file</span>
          </div>
        </div>
      )}

      {/* Mobile tab bar */}
      <nav className="mobile-tabs">
        {isCalcom && <button className={`mobile-tab ${mode === 'calcom' ? 'active' : ''}`} onClick={() => setMode('calcom')}><CalIcon /> cal.com/peer</button>}
        {isCalcom && <button className={`mobile-tab ${mode === 'coss' ? 'active' : ''}`} onClick={() => setMode('coss')}><CalIcon /> booking events</button>}
        <button className={`mobile-tab ${mode === 'big' ? 'active' : ''}`} onClick={() => setMode('big')}><BigIcon className={mode === 'big' ? 'aa-animated' : undefined} /> Big Word</button>
        <button className={`mobile-tab ${mode === 'paragraph' ? 'active' : ''}`} onClick={() => setMode('paragraph')}><ParaIcon /> Paragraph</button>
        <button className={`mobile-tab ${mode === 'ui' ? 'active' : ''}`} onClick={() => setMode('ui')}><CalIcon /> UI</button>
        <button className={`mobile-tab ${mode === 'scale' ? 'active' : ''}`} onClick={() => setMode('scale')}><ScaleIcon /> Type Scale</button>
        <button className={`mobile-tab ${mode === 'glyphs' ? 'active' : ''}`} onClick={() => setMode('glyphs')}><GlyphIcon /> Glyphs</button>
      </nav>

      {/* Mobile sub-bar: context-sensitive chips */}
      {fontName && (mode === 'glyphs' || mode === 'paragraph' || mode === 'scale') && (
        <div className="mobile-sub-bar">
          {mode === 'glyphs' && Object.keys(glyphSets).map(k => (
            <button
              key={k}
              className={`mobile-sub-btn ${activeGlyphKey === k ? 'active' : ''}`}
              onClick={() => setActiveGlyphSet(k)}
            >
              {k}
            </button>
          ))}
          {mode === 'paragraph' && (['h1', 'h2', 'h3', 'p']).map(type => (
            <button
              key={type}
              className={`mobile-sub-btn ${activeParaStyle === type ? 'active' : ''}`}
              onClick={() => setActiveParaStyle(prev => prev === type ? null : type)}
            >
              {type === 'p' ? 'P' : type.toUpperCase()}
            </button>
          ))}
          {mode === 'paragraph' && <span className="mobile-sub-divider" />}
          {mode === 'paragraph' && Object.keys(TEXT_PRESETS).map(k => (
            <button
              key={k}
              className={`mobile-sub-btn ${activeTextPreset === k ? 'active' : ''}`}
              onClick={() => {
                setActiveTextPreset(k)
                setBlocks(TEXT_PRESETS[k].map((b, i) => ({ ...b, id: String(Date.now() + i) })))
                Object.values(blockRefs.current).forEach(el => { if (el) el.textContent = '' })
              }}
            >
              {k}
            </button>
          ))}
          {mode === 'scale' && (
            <button
              className={`mobile-multi-btn ${scaleMultiSelectMode ? 'active' : ''}`}
              onClick={() => setScaleMultiSelectMode(p => !p)}
              title="Select multiple steps"
            ><MultiSelectIcon /></button>
          )}
          {mode === 'scale' && visibleScaleSteps.map(step => {
            const isSelected = selectedScaleSteps.includes(step.key) || activeScaleStep === step.key
            return (
              <button
                key={step.key}
                className={`mobile-sub-btn ${isSelected ? 'active' : ''}`}
                onClick={() => {
                  if (scaleMultiSelectMode) {
                    if (!activeScaleStep) {
                      setActiveScaleStep(step.key)
                    } else if (step.key === activeScaleStep) {
                      const next = new Set(extraScaleSteps)
                      if (next.size > 0) {
                        const first = [...next][0]
                        setActiveScaleStep(first)
                        next.delete(first)
                        setExtraScaleSteps(next)
                      } else {
                        setActiveScaleStep(null)
                      }
                      setScaleStepRangeEnd(null)
                    } else {
                      setExtraScaleSteps(prev => {
                        const next = new Set(prev)
                        next.has(step.key) ? next.delete(step.key) : next.add(step.key)
                        return next
                      })
                    }
                  } else {
                    setActiveScaleStep(prev => prev === step.key ? null : step.key)
                    setScaleStepRangeEnd(null)
                    setExtraScaleSteps(new Set())
                    setActiveParaStyle(null)
                  }
                }}
              >
                {scaleMultiSelectMode && <span className={`mobile-sub-radio ${isSelected ? 'selected' : ''}`} />}
                {step.key}
              </button>
            )
          })}
          {mode === 'scale' && scalePairSizes.size > 0 && <span className="mobile-sub-divider" />}
          {mode === 'scale' && ['lg', 'base', 'sm', 'xs'].map(opt => {
            const key = `text-${opt}`
            return (
              <button
                key={opt}
                className={`mobile-sub-btn ${scalePairSizes.has(key) ? 'active' : ''}`}
                onClick={() => setScalePairSizes(prev => {
                  const next = new Set(prev)
                  next.has(key) ? next.delete(key) : next.add(key)
                  return next
                })}
              >
                {key}
              </button>
            )
          })}
        </div>
      )}

      {/* Sidebar */}
      <button
        className="sidebar-bumpout"
        style={{ left: desktopSidebarOpen ? 'var(--sidebar-width)' : '0' }}
        onClick={() => setDesktopSidebarOpen(p => !p)}
        title={desktopSidebarOpen ? 'Collapse sidebar' : 'Expand sidebar'}
      >
        {desktopSidebarOpen ? <ChevronLeftIcon /> : <ChevronRightIcon />}
      </button>
      {!mobileSidebarOpen && (
        <button className="mobile-sidebar-lift-tab" onClick={() => setMobileSidebarOpen(true)}>
          <ChevronUpIcon />
        </button>
      )}
      <aside className={`sidebar${mobileSidebarOpen ? '' : ' mobile-collapsed'}${desktopSidebarOpen ? '' : ' desktop-collapsed'}`}>
        <button className="mobile-sidebar-handle" onClick={() => setMobileSidebarOpen(false)}>
          <ChevronDownIcon />
        </button>
        {/* Logo */}
        <div className="sidebar-logo">
          {SHOW_CLIENT_LOGO && clientSlug && clientSlug !== 'wordmark' ? (
            <ClientLogo slug={clientSlug} clientLabel={clientLabel} />
          ) : (
            <>
              <img src={logoGif} alt="Logo" className="logo-gif logo-gif--dark" />
              <img src={logoGifDark} alt="Logo" className="logo-gif logo-gif--light" />
              {clientLabel && clientSlug !== 'wordmark' && <span className="client-label">{clientLabel}</span>}
            </>
          )}
        </div>

        {/* Font upload — hidden when font is pre-selected via URL */}
        {!fontSlug && (
          <div className="sidebar-section">
            <input
              ref={fileInputRef}
              type="file"
              accept=".ttf,.otf,.woff,.woff2,.ttc"
              style={{ display: 'none' }}
              onChange={e => e.target.files[0] && loadFont(e.target.files[0])}
            />
            <button
              className="upload-btn"
              onClick={() => fileInputRef.current?.click()}
            >
              {fontName ? (
                <>
                  <span className="upload-icon">↺</span>
                  <span className="upload-name">{fontName}</span>
                </>
              ) : (
                <>
                  <span className="upload-icon">+</span>
                  <span>Open Font</span>
                </>
              )}
            </button>
            {!fontName && (
              <p className="upload-hint">or drag & drop a font file</p>
            )}
          </div>
        )}

        <div className="sidebar-divider sidebar-divider-before-mode" />

        {/* Mode switcher */}
        <div className="sidebar-section sidebar-mode-section">
          <div className="section-label">Preview Mode</div>
          <div className="mode-group">
            {isCalcom && (
              <div className="mode-btn-row">
                <ModeBtn active={mode === 'calcom'} onClick={() => setMode('calcom')}>
                  <CalIcon /> cal.com/peer
                </ModeBtn>
                {fontName && mode === 'calcom' && (
                  <button
                    ref={calcomPanelBtnRef}
                    className={`align-btn styles-toggle-btn ${calcomPanelOpen ? 'active' : ''}`}
                    title="Type roles panel"
                    onClick={() => setCalcomPanelOpen(p => !p)}
                  >
                    <SlidersIcon />
                  </button>
                )}
              </div>
            )}
            {isCalcom && (
              <div className="mode-btn-row">
                <ModeBtn active={mode === 'coss'} onClick={() => setMode('coss')}>
                  <CalIcon /> booking events
                </ModeBtn>
                {fontName && mode === 'coss' && (
                  <button
                    ref={cossPanelBtnRef}
                    className={`align-btn styles-toggle-btn ${cossPanelOpen ? 'active' : ''}`}
                    title="Type roles panel"
                    onClick={() => setCossPanelOpen(p => !p)}
                  >
                    <SlidersIcon />
                  </button>
                )}
              </div>
            )}
            <ModeBtn active={mode === 'big'} onClick={() => setMode('big')}>
              <BigIcon className={mode === 'big' ? 'aa-animated' : undefined} /> Big Word
            </ModeBtn>
            <div className="mode-btn-row">
              <ModeBtn active={mode === 'paragraph'} onClick={() => setMode('paragraph')}>
                <ParaIcon /> Paragraph
              </ModeBtn>
              {fontName && mode === 'paragraph' && (
                <button
                  ref={stylesPanelBtnRef}
                  className={`align-btn styles-toggle-btn ${paraStylesPanelOpen ? 'active' : ''}`}
                  title="Styles panel"
                  onClick={() => setParaStylesPanelOpen(p => !p)}
                >
                  <SlidersIcon />
                </button>
              )}
            </div>
            <ModeBtn active={mode === 'ui'} onClick={() => setMode('ui')}>
              <CalIcon /> UI
            </ModeBtn>
            <div className="mode-btn-row">
              <ModeBtn active={mode === 'scale'} onClick={() => setMode('scale')}>
                <ScaleIcon /> Type Scale
              </ModeBtn>
              {fontName && mode === 'scale' && (
                <button
                  ref={scalePanelBtnRef}
                  className={`align-btn styles-toggle-btn ${scaleStepsPanelOpen ? 'active' : ''}`}
                  title="Scale steps panel"
                  onClick={() => setScaleStepsPanelOpen(p => !p)}
                >
                  <SlidersIcon />
                </button>
              )}
            </div>
            <ModeBtn active={mode === 'glyphs'} onClick={() => setMode('glyphs')}>
              <GlyphIcon /> Glyphs
            </ModeBtn>
          </div>
        </div>

        {/* Scale mode controls */}
        {mode === 'scale' && fontName && (
          <>
            <div className="sidebar-divider" />
            <div className="sidebar-section">
              <div className="section-label">Type Scale</div>
              <div className="slider-label">
                <span className="slider-label-left">
                  <span className="slider-label-text">Max xl tier</span>
                </span>
                <input
                  className="slider-number"
                  type="number"
                  min={1}
                  max={9}
                  step={1}
                  value={scaleMaxXl}
                  onChange={e => setScaleMaxXl(Math.min(9, Math.max(1, parseInt(e.target.value, 10) || 1)))}
                />
              </div>
              <div className="section-label" style={{ marginTop: 4 }}>Body Pairing</div>
              <div className="scale-pair-seg">
                {['lg', 'base', 'sm', 'xs'].map(opt => {
                  const key = `text-${opt}`
                  const active = scalePairSizes.has(key)
                  return (
                    <button
                      key={opt}
                      className={`scale-pair-btn ${active ? 'active' : ''}`}
                      onClick={() => setScalePairSizes(prev => {
                        const next = new Set(prev)
                        next.has(key) ? next.delete(key) : next.add(key)
                        return next
                      })}
                    >
                      {key}
                    </button>
                  )
                })}
              </div>
            </div>
          </>
        )}

        <div className="sidebar-divider" />

        {/* Cal.com font radio */}
        {mode === 'calcom' && (
          <>
            <div className="sidebar-divider" />
            <div className="sidebar-section">
              <div className="section-label">Font</div>
              <label className="calcom-radio-label">
                <input type="radio" name="calcom-font" value={calcomFontPrimary} checked={calcomFont === calcomFontPrimary} onChange={() => setCalcomFont(calcomFontPrimary)} />
                {calcomFontPrimaryLabel}
              </label>
              <label className="calcom-radio-label">
                <input type="radio" name="calcom-font" value="inter" checked={calcomFont === 'inter'} onChange={() => setCalcomFont('inter')} />
                Inter 4.1
              </label>
            </div>
          </>
        )}

        {/* Typography controls */}
        {mode !== 'calcom' && (
        <div className="sidebar-section">
          <div className="typography-header">
            <div className="section-label">
              Typography
              {effectiveParaStyle && activeParaStyle && (
                <span className="section-label-sub">
                  {activeParaStyle === 'p' ? 'P' : activeParaStyle.toUpperCase()}
                </span>
              )}
            </div>
            {mode !== 'scale' && (
            <div className="align-group">
              {(() => {
                const isDirty = effectiveParaStyle
                  ? paraStyles[effectiveParaStyle].size !== DEFAULT_PARA_STYLES[effectiveParaStyle].size ||
                    paraStyles[effectiveParaStyle].tracking !== DEFAULT_PARA_STYLES[effectiveParaStyle].tracking ||
                    paraStyles[effectiveParaStyle].leading !== DEFAULT_PARA_STYLES[effectiveParaStyle].leading
                  : fontSize !== 200 || letterSpacing !== 0 || lineHeight !== 1.1 || textAlign !== 'left'
                return (
                  <button
                    className={`align-btn ${isDirty ? 'active' : 'reset-clean'}`}
                    title="Reset typography"
                    style={isDirty ? {} : { pointerEvents: 'none' }}
                    onClick={() => {
                      if (effectiveParaStyle) {
                        setParaStyles(prev => ({
                          ...prev,
                          [effectiveParaStyle]: { ...prev[effectiveParaStyle], ...DEFAULT_PARA_STYLES[effectiveParaStyle] }
                        }))
                      } else {
                        setFontSize(200)
                        setLetterSpacing(0)
                        setLineHeight(1.1)
                        setTextAlign('left')
                      }
                    }}
                  ><ResetIcon /></button>
                )
              })()}
              {['left', 'center', 'right'].map(a => (
                <button
                  key={a}
                  className={`align-btn ${textAlign === a ? 'active' : ''}`}
                  onClick={() => setTextAlign(a)}
                  title={`Align ${a}`}
                >
                  {a === 'left' ? <AlignLeftIcon /> : a === 'center' ? <AlignCenterIcon /> : <AlignRightIcon />}
                </button>
              ))}
            </div>
            )}
          </div>
          {isFamily && (
            <select
              className="instance-select"
              value={scopedWeight ?? ''}
              onChange={e => setScopedWeight(e.target.value)}
              title="Style"
            >
              {familyStyles.map(s => (
                <option key={s.key} value={s.key}>{s.label}</option>
              ))}
            </select>
          )}
          {(italicFontFace || variationAxes.some(a => a.tag === 'ital')) && (() => {
            const italAxis = variationAxes.find(a => a.tag === 'ital')
            return (
              <div className="roman-italic-toggle">
                <button
                  className={`roman-italic-btn${!scopedItalic ? ' active' : ''}`}
                  onClick={() => {
                    setScopedItalic(false)
                    if (italAxis) setAxisValues(prev => ({ ...prev, ital: italAxis.min ?? 0 }))
                  }}
                >Roman</button>
                <button
                  className={`roman-italic-btn${scopedItalic ? ' active' : ''}`}
                  onClick={() => {
                    setScopedItalic(true)
                    if (italAxis) setAxisValues(prev => ({ ...prev, ital: italAxis.max ?? 1 }))
                  }}
                >Italic</button>
              </div>
            )
          })()}
          {fontFace && (/sb\s*romie/i.test(fontFamilyLabel) || /romie/i.test(fontName || '')) && (glyphFeatures.italic?.includes('ss04') || glyphFeatures.roman?.includes('ss05')) && (
            <div className="feature-toggles">
              {glyphFeatures.italic?.includes('ss04') && (
                <button
                  className={`roman-italic-btn${scopedSs04 ? ' active' : ''}`}
                  disabled={!scopedItalic}
                  title={scopedItalic ? 'Stylistic Set 4 (italic)' : 'ss04 applies to italic only'}
                  onClick={toggleScopedSs04}
                >ss04</button>
              )}
              {glyphFeatures.roman?.includes('ss05') && (
                <button
                  className={`roman-italic-btn${scopedSs05 ? ' active' : ''}`}
                  disabled={scopedItalic}
                  title={!scopedItalic ? 'Stylistic Set 5 (roman)' : 'ss05 applies to roman only'}
                  onClick={toggleScopedSs05}
                >ss05</button>
              )}
            </div>
          )}
          {ttcFonts.length > 1 && (
            <select
              className="instance-select"
              value={ttcIndex}
              onChange={e => selectTTCFont(Number(e.target.value))}
            >
              {ttcFonts.map((name, i) => (
                <option key={i} value={i}>{name}</option>
              ))}
            </select>
          )}
          {namedInstances.length > 0 && (() => {
            const currentCoords = effectiveScaleStep
              ? { ...axisValues, ...scaleAxisOverrides[effectiveScaleStep] }
              : effectiveParaStyle
              ? { ...axisValues, ...paraStyles[effectiveParaStyle].axisOverrides }
              : axisValues
            const activeInst = namedInstances.find(inst =>
              variationAxes.every(a => (currentCoords[a.tag] ?? a.defaultVal) === inst.coordinates[a.tag])
            )
            const applyInstance = (name) => {
              const inst = namedInstances.find(i => i.name === name)
              if (!inst) return
              if (effectiveScaleStep) {
                setScaleAxisOverrides(prev => {
                  const next = { ...prev }
                  selectedScaleSteps.forEach(k => { next[k] = { ...inst.coordinates } })
                  return next
                })
              } else if (effectiveParaStyle) {
                setParaStyles(prev => ({
                  ...prev,
                  [effectiveParaStyle]: { ...prev[effectiveParaStyle], axisOverrides: { ...inst.coordinates } }
                }))
              } else {
                setAxisValues({ ...inst.coordinates })
              }
            }
            return (
              <select
                className="instance-select"
                value={activeInst?.name ?? ''}
                onChange={e => applyInstance(e.target.value)}
              >
                {!activeInst && <option value="" disabled>—</option>}
                {namedInstances.map(inst => (
                  <option key={inst.name} value={inst.name}>{inst.name}</option>
                ))}
              </select>
            )
          })()}
          {/* Size/Tracking/Leading are per-step in Type Scale, so hide them there */}
          {mode !== 'scale' && (<>
          {effectiveParaStyle ? (
            <SliderRow
              label="Size"
              value={paraStyles[effectiveParaStyle].size}
              min={8}
              max={400}
              step={1}
              lockedAbove={effectiveParaStyle === 'p' ? paraComfortableMax : undefined}
              onChange={v => {
                const capped = effectiveParaStyle === 'p' ? Math.min(v, paraComfortableMax) : v
                setParaStyles(prev => ({ ...prev, [effectiveParaStyle]: { ...prev[effectiveParaStyle], size: capped } }))
              }}
            />
          ) : (
            <SliderRow
              label="Size"
              value={fontSize}
              min={8}
              max={400}
              step={1}
              onChange={setFontSize}
            />
          )}
          {effectiveParaStyle ? (
            <SliderRow
              label="Tracking"
              value={paraStyles[effectiveParaStyle].tracking}
              min={-0.2}
              max={0.5}
              step={0.001}
              onChange={v => setParaStyles(prev => ({ ...prev, [effectiveParaStyle]: { ...prev[effectiveParaStyle], tracking: v } }))}
              display={paraStyles[effectiveParaStyle].tracking.toFixed(3)}
            />
          ) : (
            <SliderRow
              label="Tracking"
              value={letterSpacing}
              min={-0.2}
              max={0.5}
              step={0.001}
              onChange={setLetterSpacing}
              display={letterSpacing.toFixed(3)}
            />
          )}
          {effectiveParaStyle ? (
            <SliderRow
              label="Leading"
              value={paraStyles[effectiveParaStyle].leading}
              min={0.6}
              max={3}
              step={0.01}
              onChange={v => setParaStyles(prev => ({ ...prev, [effectiveParaStyle]: { ...prev[effectiveParaStyle], leading: v } }))}
              display={paraStyles[effectiveParaStyle].leading.toFixed(2)}
            />
          ) : (
            <SliderRow
              label="Leading"
              value={lineHeight}
              min={0.6}
              max={3}
              step={0.01}
              onChange={setLineHeight}
              display={lineHeight.toFixed(2)}
            />
          )}
          </>)}
        </div>
        )}

        {/* Variable font axes */}
        {variationAxes.length > 0 && (
          <>
            <div className="sidebar-divider" />
            <div className="sidebar-section">
              <div className="typography-header">
                <div className="section-label">
                  Variable Axes
                  {effectiveScaleStep && (
                    <button className="section-label-exit" onClick={() => { setActiveScaleStep(null); setScaleStepRangeEnd(null); setExtraScaleSteps(new Set()) }}>
                      {selectedScaleSteps.length > 1 ? `${selectedScaleSteps.length} steps` : effectiveScaleStep} ×
                    </button>
                  )}
                  {mode === 'scale' && effectiveParaStyle && (
                    <button className="section-label-exit" onClick={() => setActiveParaStyle(null)}>
                      {effectiveParaStyle === 'p' ? 'Para' : effectiveParaStyle.toUpperCase()} ×
                    </button>
                  )}
                  {effectiveCalcomRole && (
                    <button className="section-label-exit" onClick={() => setActiveCalcomRole(null)} title="Back to master">
                      {CALCOM_ROLE_LABELS[effectiveCalcomRole]} ×
                    </button>
                  )}
                  {effectiveCossRole && (
                    <button className="section-label-exit" onClick={() => setActiveCossRole(null)} title="Back to master">
                      {COSS_ROLE_LABELS[effectiveCossRole]} ×
                    </button>
                  )}
                </div>
                {(() => {
                  const axesDirty = effectiveScaleStep
                    ? JSON.stringify(scaleAxisOverrides[effectiveScaleStep]) !== JSON.stringify(DEFAULT_SCALE_AXIS_OVERRIDES[effectiveScaleStep])
                    : effectiveParaStyle
                    ? JSON.stringify(paraStyles[effectiveParaStyle].axisOverrides) !== JSON.stringify(DEFAULT_PARA_STYLES[effectiveParaStyle].axisOverrides)
                    : effectiveCalcomRole
                    ? JSON.stringify(calcomRoles[effectiveCalcomRole].axisOverrides) !== JSON.stringify(DEFAULT_CALCOM_ROLES[effectiveCalcomRole].axisOverrides)
                    : effectiveCossRole
                    ? JSON.stringify(cossRoles[effectiveCossRole].axisOverrides) !== JSON.stringify(DEFAULT_COSS_ROLES[effectiveCossRole].axisOverrides)
                    : variationAxes.some(a => axisValues[a.tag] !== a.defaultVal)
                  return (
                    <button
                      className={`align-btn ${axesDirty ? 'active' : 'reset-clean'}`}
                      title="Reset axes"
                      style={axesDirty ? {} : { pointerEvents: 'none' }}
                      onClick={() => {
                        if (effectiveScaleStep) {
                          setScaleAxisOverrides(prev => {
                            const next = { ...prev }
                            selectedScaleSteps.forEach(k => { next[k] = { ...DEFAULT_SCALE_AXIS_OVERRIDES[k] } })
                            return next
                          })
                        } else if (effectiveParaStyle) {
                          setParaStyles(prev => ({
                            ...prev,
                            [effectiveParaStyle]: { ...prev[effectiveParaStyle], axisOverrides: { ...DEFAULT_PARA_STYLES[effectiveParaStyle].axisOverrides } }
                          }))
                        } else if (effectiveCalcomRole) {
                          setCalcomRoles(prev => ({
                            ...prev,
                            [effectiveCalcomRole]: { ...prev[effectiveCalcomRole], axisOverrides: { ...DEFAULT_CALCOM_ROLES[effectiveCalcomRole].axisOverrides } }
                          }))
                        } else if (effectiveCossRole) {
                          setCossRoles(prev => ({
                            ...prev,
                            [effectiveCossRole]: { ...prev[effectiveCossRole], axisOverrides: { ...DEFAULT_COSS_ROLES[effectiveCossRole].axisOverrides } }
                          }))
                        } else {
                          const defaults = {}
                          variationAxes.forEach(a => { defaults[a.tag] = a.defaultVal })
                          setAxisValues(defaults)
                        }
                      }}
                    ><ResetIcon /></button>
                  )
                })()}
              </div>
              {variationAxes.map(axis => {
                const val = effectiveScaleStep
                  ? (scaleAxisOverrides[effectiveScaleStep]?.[axis.tag] ?? axisValues[axis.tag] ?? axis.defaultVal)
                  : effectiveParaStyle
                  ? (paraStyles[effectiveParaStyle].axisOverrides[axis.tag] ?? axisValues[axis.tag] ?? axis.defaultVal)
                  : effectiveCalcomRole
                  ? (calcomRoles[effectiveCalcomRole].axisOverrides[axis.tag] ?? axisValues[axis.tag] ?? axis.defaultVal)
                  : effectiveCossRole
                  ? (cossRoles[effectiveCossRole].axisOverrides[axis.tag] ?? axisValues[axis.tag] ?? axis.defaultVal)
                  : (mode === 'scale' && axis.tag === 'opsz')
                  ? (() => { const v = scaleAxisOverrides[TAILWIND_SCALE[0].key]?.opsz ?? 'auto'; return TAILWIND_SCALE.every(s => (scaleAxisOverrides[s.key]?.opsz ?? 'auto') === v) ? v : 'auto' })()
                  : (axisValues[axis.tag] ?? axis.defaultVal)
                const autoOpszValue = effectiveScaleStep
                  ? (TAILWIND_SCALE.find(s => s.key === effectiveScaleStep)?.pxSize ?? fontSize)
                  : effectiveCalcomRole
                  ? calcomRoles[effectiveCalcomRole].size
                  : effectiveCossRole
                  ? cossRoles[effectiveCossRole].size
                  : effectiveParaStyle
                  ? paraStyles[effectiveParaStyle].size
                  : fontSize
                return (
                  <SliderRow
                    key={axis.tag}
                    label={axis.name}
                    tag={axis.tag}
                    value={val}
                    min={axis.min}
                    max={axis.max}
                    step={axis.tag === 'opsz' ? 0.25 : (axis.max - axis.min) > 10 ? 1 : 0.01}
                    onChange={v => {
                      if (effectiveScaleStep) {
                        setScaleAxisOverrides(prev => {
                          const next = { ...prev }
                          selectedScaleSteps.forEach(k => { next[k] = { ...next[k], [axis.tag]: v } })
                          return next
                        })
                      } else if (effectiveParaStyle) {
                        setParaStyles(prev => ({
                          ...prev,
                          [effectiveParaStyle]: { ...prev[effectiveParaStyle], axisOverrides: { ...prev[effectiveParaStyle].axisOverrides, [axis.tag]: v } }
                        }))
                      } else if (effectiveCalcomRole) {
                        setCalcomRoles(prev => ({
                          ...prev,
                          [effectiveCalcomRole]: { ...prev[effectiveCalcomRole], axisOverrides: { ...prev[effectiveCalcomRole].axisOverrides, [axis.tag]: v } }
                        }))
                      } else if (effectiveCossRole) {
                        setCossRoles(prev => ({
                          ...prev,
                          [effectiveCossRole]: { ...prev[effectiveCossRole], axisOverrides: { ...prev[effectiveCossRole].axisOverrides, [axis.tag]: v } }
                        }))
                      } else if (mode === 'scale' && axis.tag === 'opsz') {
                        setScaleAxisOverrides(prev => {
                          const next = { ...prev }
                          TAILWIND_SCALE.forEach(s => { next[s.key] = { ...next[s.key], opsz: v } })
                          return next
                        })
                      } else {
                        setAxisValues(prev => ({ ...prev, [axis.tag]: v }))
                      }
                    }}
                    allowAuto={axis.tag === 'opsz'}
                    autoValue={axis.tag === 'opsz' ? autoOpszValue : undefined}
                    display={axis.tag === 'opsz' && val === 'auto' ? 'auto' : Math.round(val)}
                  />
                )
              })}
            </div>
          </>
        )}

        {/* Glyph set tabs — only shown in glyphs mode */}
        {mode === 'glyphs' && (
          <>
            <div className="sidebar-divider" />
            <div className="sidebar-section">
              <div className="section-label">Glyph Set</div>
              <div className="glyph-set-group">
                {Object.keys(glyphSets).map(k => (
                  <button
                    key={k}
                    className={`glyph-set-btn ${activeGlyphKey === k ? 'active' : ''}`}
                    onClick={() => setActiveGlyphSet(k)}
                  >
                    {k}
                  </button>
                ))}
              </div>
            </div>
          </>
        )}
        {/* Copyright footer */}
        <div className="sidebar-footer">
          {fontVersion && <div className="font-version">v{fontVersion}</div>}
          {clientSlug && clientSlug !== 'wordmark'
            ? `\u00A9${new Date().getFullYear()} ${clientLabel}, courtesy of WORDMARK. Please do not distribute without approval and understanding of IP holder.`
            : `\u00A9${new Date().getFullYear()} WORDMARK.`
          }
        </div>
      </aside>

      {/* Desktop preset bar — top-left of preview, paragraph mode only */}
      {fontName && mode === 'paragraph' && (
        <div className="preview-preset-bar">
          {Object.keys(TEXT_PRESETS).map(k => (
            <button
              key={k}
              className={`preview-preset-btn ${activeTextPreset === k ? 'active' : ''}`}
              onClick={() => {
                setActiveTextPreset(k)
                setBlocks(TEXT_PRESETS[k].map((b, i) => ({ ...b, id: String(Date.now() + i) })))
                Object.values(blockRefs.current).forEach(el => { if (el) el.textContent = '' })
              }}
            >
              {k}
            </button>
          ))}
        </div>
      )}

      {/* Main preview area */}
      <main className="preview-area" ref={previewAreaRef}>
        {!fontName && (
          <div className="empty-state">
            <img src={logoGif} alt="Logo" className="empty-logo" />
            <p className="empty-hint">Open a font file to begin proofing</p>
          </div>
        )}

        {mode === 'calcom' && (
          <CalcomPreview key={calcomFont} roleStyle={roleStyle} activeRole={activeCalcomRole} onRoleClick={setActiveCalcomRole} />
        )}

        {mode === 'coss' && (
          <CossPreview key={calcomFont} roleStyle={cossRoleStyle} activeRole={activeCossRole} onRoleClick={setActiveCossRole} />
        )}

        {fontName && mode === 'ui' && (
          <div className="preview-ui">
            <Suspense fallback={<div className="preview-ui-loading">Loading UI kit…</div>}>
              <UiPreview
                /* only the font IDENTITY — NOT the proofing size/leading/tracking,
                   which would otherwise be inherited by the UI kit and blow up every
                   inline element's line box (the kit sets its own type sizes) */
                fontStyle={{
                  fontFamily: previewStyle.fontFamily,
                  fontVariationSettings,
                  fontFeatureSettings: proofFeatureSettings,
                  fontStyle,
                  fontOpticalSizing: previewStyle.fontOpticalSizing,
                }}
                weight={Number(axisValues.wght) || 400}
                boldWeight={Math.min(900, (Number(axisValues.wght) || 400) + 300)}
              />
            </Suspense>
          </div>
        )}

        {fontName && mode === 'big' && (
          <div className="preview-big">
            <div
              ref={bigEditorCallback}
              contentEditable
              suppressContentEditableWarning
              spellCheck={false}
              className="editable-big"
              style={previewStyle}
              onInput={e => setBigText(e.currentTarget.textContent)}
            />
          </div>
        )}

        {fontName && mode === 'paragraph' && (
          <div className="preview-paragraph" style={{ paddingRight: `${rightMargin}px` }}>
              <div
                className="escape-bar"
                style={{ right: `${rightMargin - 14}px` }}
                onMouseDown={handleEscapeBarMouseDown}
                title="Drag to expand column"
              />
              {blocks.map(block => {
                const focused = focusedBlockId === block.id
                return (
                <div
                  key={block.id}
                  ref={el => {
                    if (el) {
                      blockRefs.current[block.id] = el
                      if (!el.textContent) el.textContent = block.text
                    } else {
                      delete blockRefs.current[block.id]
                    }
                  }}
                  contentEditable
                  suppressContentEditableWarning
                  spellCheck={false}
                  className={`para-block para-block--${block.type}${activeParaStyle === block.type ? ' para-block--selected' : ''}`}
                  style={blockStyle(block.type)}
                  onMouseDown={e => { if (!focused) pendingBlockCaret.current = { id: block.id, offset: caretCharOffset(e.currentTarget, e.clientX, e.clientY) } }}
                  onFocus={() => setFocusedBlockId(block.id)}
                  onBlur={e => {
                    // Commit the edited raw text and clear the imperative text node so
                    // React can render styled spans cleanly (no duplicated text).
                    const t = e.currentTarget.textContent ?? ''
                    e.currentTarget.textContent = ''
                    setBlocks(prev => prev.map(x => x.id === block.id ? { ...x, text: t } : x))
                    setFocusedBlockId(cur => cur === block.id ? null : cur)
                  }}
                  onInput={e => handleBlockInput(block.id, e)}
                  onKeyDown={e => handleBlockKeyDown(block.id, e)}
                >
                  {focused ? null : renderInline(block.text, inlineStyle(block.type, 'italic'), inlineStyle(block.type, 'bold'))}
                </div>
              )})}
          </div>
        )}

        {fontName && mode === 'scale' && (() => {
          const hasPairs = scalePairSizes.size > 0
          // escape bar at right: 48(padding) + scaleBaseMargin - 14(handle offset)
          const escapeRight = 34 + scaleBaseMargin
          return (
            <div className="preview-scale">
              {hasPairs && (
                <>
                  <div className="scale-margin-fill" style={{ width: `${48 + scaleBaseMargin}px` }} />
                  <div
                    className="escape-bar scale-escape-bar"
                    style={{ right: `${escapeRight}px` }}
                    onMouseDown={handleScaleEscapeBarMouseDown}
                    onTouchStart={handleScaleEscapeBarMouseDown}
                    title="Drag to adjust body column width"
                  />
                </>
              )}
              {visibleScaleSteps.map(step => (
                <div
                  key={step.key}
                  className={`scale-row${selectedScaleSteps.includes(step.key) || activeScaleStep === step.key ? ' scale-row--selected' : ''}`}
                  onClick={() => {
                    setActiveScaleStep(k => k === step.key ? null : step.key)
                    setScaleStepRangeEnd(null)
                    setExtraScaleSteps(new Set())
                    setActiveParaStyle(null)
                  }}
                >
                  <div className="scale-row-meta">
                    <span className="scale-row-tag">
                      {step.key}
                      {scalePairSteps.length > 0 && (
                        <span className="scale-row-with">
                          {' with '}
                          {scalePairSteps.map(p => p.key).join(', ')}
                        </span>
                      )}
                    </span>
                    <span className="scale-row-px">
                      {step.pxSize}px
                      {scalePairSteps.length > 0 && (
                        <span> / {scalePairSteps.map(p => `${p.pxSize}px`).join(', ')}</span>
                      )}
                    </span>
                  </div>
                  <div
                    ref={el => {
                      if (el) {
                        scaleRowRefs.current[step.key] = el
                        if (!el.textContent) el.textContent = scaleLabelText
                      } else {
                        delete scaleRowRefs.current[step.key]
                      }
                    }}
                    contentEditable
                    suppressContentEditableWarning
                    spellCheck={false}
                    className="scale-row-text"
                    style={scaleStepStyle(step)}
                    onInput={e => handleScaleLabelInput(step.key, e)}
                    onClick={e => e.stopPropagation()}
                  />
                  {scalePairSteps.map(pairStep => {
                    const clamped = scaleBaseClampPx != null ? Math.min(pairStep.pxSize, scaleBaseClampPx) : null
                    const effective = clamped != null && clamped < pairStep.pxSize ? clamped : null
                    return (
                      <div
                        key={pairStep.key}
                        ref={el => {
                          const refKey = `${step.key}__${pairStep.key}`
                          if (el) {
                            scalePairRefs.current[refKey] = el
                            if (!el.textContent) el.textContent = scalePairText
                          } else {
                            delete scalePairRefs.current[refKey]
                          }
                        }}
                        contentEditable
                        suppressContentEditableWarning
                        spellCheck={false}
                        className="scale-pair-text"
                        data-pair-size={pairStep.key}
                        style={{ ...scaleStepStyle(pairStep, effective), maxWidth: hasPairs ? `calc(100% - ${scaleBaseMargin}px)` : undefined }}
                        onInput={e => handleScalePairInput(`${step.key}__${pairStep.key}`, e)}
                        onClick={e => e.stopPropagation()}
                      />
                    )
                  })}
                </div>
              ))}
            </div>
          )
        })()}

        {fontName && mode === 'glyphs' && (
          <div className="preview-glyphs">
            {glyphMatchUnavailable && (
              <div className="glyph-match-note">
                Showing every glyph in the set. To trim this to the characters this font actually contains, import an uncompressed <strong>.ttf</strong> or <strong>.otf</strong>.
              </div>
            )}
            <div className="glyphs-grid" style={{
              fontFamily: previewStyle.fontFamily,
              fontStyle,
              fontVariationSettings,
              fontOpticalSizing: 'none',
              // Dedicated ss04/ss05 sections force their feature so the alternates show.
              fontFeatureSettings: activeGlyphKey === 'ss04'
                ? '"calt" 0, "ss20" 0, "ss04" 1'
                : activeGlyphKey === 'ss05'
                ? '"calt" 0, "ss20" 0, "ss05" 1'
                : proofFeatureSettings,
              fontSize: `${Math.min(fontSize, 120)}px`,
              lineHeight: 1,
              transition: 'font-variation-settings 0.15s ease',
            }}>
              {glyphSets[activeGlyphKey].filter(glyph => {
                // Curated sets (ss04/ss05/PUA) are pre-scoped to the font, skip cmap filter
                if (CURATED_GLYPH_SETS.has(activeGlyphKey)) return true
                if (!supportedRanges) return true
                const isCombining = glyph.charCodeAt(0) === 0x25CC
                const cp = glyph.codePointAt(isCombining ? 1 : 0)
                return supportedRanges.some(([a, b]) => cp >= a && cp <= b)
              }).map((glyph, i) => {
                const isCombining = glyph.charCodeAt(0) === 0x25CC
                const cp = glyph.codePointAt(isCombining ? 1 : 0)
                return (
                  <div key={i} className="glyph-cell">
                    <div className="glyph-char">{glyph}</div>
                    <div className="glyph-code">U+{cp.toString(16).toUpperCase().padStart(4, '0')}</div>
                  </div>
                )
              })}
            </div>
          </div>
        )}
      </main>

      {/* Cal.com roles popover */}
      {calcomPanelOpen && mode === 'calcom' && (() => {
        const rect = calcomPanelBtnRef.current?.getBoundingClientRect()
        if (!rect) return null
        return (
          <div
            ref={calcomPanelPopoverRef}
            className="para-styles-panel"
            style={{
              top: rect.bottom + 8,
              left: rect.left,
              '--caret-x': `${rect.width / 2}px`,
            }}
          >
            {/* migrated to shared StyleScopeList (single-select); panel keeps its own
                trigger/positioning. Rows show every axis (denser than the type pickers)
                — kept as tight as the old .para-styles-row via .ssd-list--dense. */}
            <StyleScopeList
              inline
              mode="single"
              className="ssd-list--dense"
              onSelect={key => { setActiveCalcomRole(prev => prev === key ? null : key); setCalcomPanelOpen(false) }}
              rows={Object.entries(CALCOM_ROLE_LABELS).map(([key, label]) => {
                const r = calcomRoles[key]
                const merged = { ...axisValues, ...r.axisOverrides }
                const fvs = Object.entries(merged).map(([t, v]) => `"${t}" ${v}`).join(', ') || 'normal'
                const family = calcomFont === 'inter'
                  ? '"Inter", system-ui, sans-serif'
                  : calcomFont === 'calsans'
                    ? '"CalSans"'
                    : fontFace ? `"${fontFace.family}"` : 'serif'
                return {
                  id: key,
                  label,
                  labelStyle: {
                    fontFamily: family,
                    fontSize: `${Math.min(r.size, 22)}px`,
                    fontVariationSettings: (calcomFont === 'calsans') ? fvs : 'normal',
                    fontOpticalSizing: 'none',
                    fontSynthesis: 'none',
                    lineHeight: 1.3,
                  },
                  chips: [
                    { text: `${r.size}px`, kind: 'size' },
                    { text: r.tracking.toFixed(3), kind: 'size' },
                    ...(calcomFont !== 'inter' ? variationAxes.map(axis => {
                      const val = r.axisOverrides[axis.tag] ?? axisValues[axis.tag] ?? axis.defaultVal
                      const isLocal = axis.tag in r.axisOverrides
                      return {
                        text: `${axis.tag} ${val === 'auto' ? 'auto' : Number.isInteger(val) ? val : val.toFixed(1)}`,
                        kind: isLocal ? 'local' : 'axis',
                      }
                    }) : []),
                  ],
                  selected: activeCalcomRole === key,
                }
              })}
            />
          </div>
        )
      })()}

      {cossPanelOpen && mode === 'coss' && (() => {
        const rect = cossPanelBtnRef.current?.getBoundingClientRect()
        if (!rect) return null
        return (
          <div
            ref={cossPanelPopoverRef}
            className="para-styles-panel"
            style={{
              top: rect.bottom + 8,
              left: rect.left,
              '--caret-x': `${rect.width / 2}px`,
            }}
          >
            {/* migrated to shared StyleScopeList (single-select); mirrors the calcom
                role picker — every axis shown, kept tight via .ssd-list--dense. */}
            <StyleScopeList
              inline
              mode="single"
              className="ssd-list--dense"
              onSelect={key => { setActiveCossRole(prev => prev === key ? null : key); setCossPanelOpen(false) }}
              rows={Object.entries(COSS_ROLE_LABELS).map(([key, label]) => {
                const r = cossRoles[key]
                const merged = { ...axisValues, ...r.axisOverrides }
                const fvs = Object.entries(merged).map(([t, v]) => `"${t}" ${v}`).join(', ') || 'normal'
                const family = calcomFont === 'inter'
                  ? '"Inter", system-ui, sans-serif'
                  : calcomFont === 'calsans'
                    ? '"CalSans"'
                    : fontFace ? `"${fontFace.family}"` : 'serif'
                return {
                  id: key,
                  label,
                  labelStyle: {
                    fontFamily: family,
                    fontSize: `${Math.min(r.size, 22)}px`,
                    fontVariationSettings: (calcomFont === 'calsans') ? fvs : 'normal',
                    fontOpticalSizing: 'none',
                    fontSynthesis: 'none',
                    lineHeight: 1.3,
                  },
                  chips: [
                    { text: `${r.size}px`, kind: 'size' },
                    { text: r.tracking.toFixed(3), kind: 'size' },
                    ...(calcomFont !== 'inter' ? variationAxes.map(axis => {
                      const val = r.axisOverrides[axis.tag] ?? axisValues[axis.tag] ?? axis.defaultVal
                      const isLocal = axis.tag in r.axisOverrides
                      return {
                        text: `${axis.tag} ${val === 'auto' ? 'auto' : Number.isInteger(val) ? val : val.toFixed(1)}`,
                        kind: isLocal ? 'local' : 'axis',
                      }
                    }) : []),
                  ],
                  selected: activeCossRole === key,
                }
              })}
            />
          </div>
        )
      })()}

      {/* Scale steps panel popover */}
      {scaleStepsPanelOpen && mode === 'scale' && fontName && (() => {
        const rect = scalePanelBtnRef.current?.getBoundingClientRect()
        if (!rect) return null
        return (
          <div
            ref={scalePanelPopoverRef}
            className="para-styles-panel scale-steps-panel"
            style={{ top: rect.bottom + 8, left: rect.left, '--caret-x': `${rect.width / 2}px` }}
          >
            <div className="scale-steps-header">
              <button
                className={`scale-multi-btn ${scaleMultiSelectMode ? 'active' : ''}`}
                onClick={() => setScaleMultiSelectMode(p => !p)}
                title="Select multiple steps"
              ><MultiSelectIcon /></button>
            </div>
            {/* migrated to shared StyleScopeList (multi-select); keeps this panel's own
                trigger/positioning and the shift-range / multi-mode selection logic */}
            <StyleScopeList
              inline
              mode="multi"
              onSelect={(key, e) => {
                if (e.shiftKey && activeScaleStep && activeScaleStep !== key) {
                  setScaleStepRangeEnd(key)
                } else if (scaleMultiSelectMode) {
                  if (!activeScaleStep) {
                    setActiveScaleStep(key)
                  } else if (key === activeScaleStep) {
                    const next = new Set(extraScaleSteps)
                    if (next.size > 0) {
                      const first = [...next][0]
                      setActiveScaleStep(first)
                      next.delete(first)
                      setExtraScaleSteps(next)
                    } else {
                      setActiveScaleStep(null)
                    }
                    setScaleStepRangeEnd(null)
                  } else {
                    setExtraScaleSteps(prev => {
                      const next = new Set(prev)
                      next.has(key) ? next.delete(key) : next.add(key)
                      return next
                    })
                  }
                } else {
                  setActiveScaleStep(prev => prev === key ? null : key)
                  setScaleStepRangeEnd(null)
                  setExtraScaleSteps(new Set())
                  setActiveParaStyle(null)
                }
              }}
              rows={visibleScaleSteps.map(step => {
                const isActive = selectedScaleSteps.includes(step.key) || activeScaleStep === step.key
                const overrides = scaleAxisOverrides[step.key] ?? {}
                const localOverrides = Object.entries(overrides).filter(([tag]) => tag !== 'opsz' || overrides[tag] !== 'auto')
                return {
                  id: step.key,
                  label: step.key,
                  labelStyle: { ...scaleStepStyle(step), fontSize: `${Math.min(step.pxSize, 20)}px`, lineHeight: 1.3 },
                  chips: [
                    { text: `${step.pxSize}px`, kind: 'size' },
                    ...localOverrides.map(([tag, val]) => ({
                      text: `${tag} ${val === 'auto' ? 'auto' : Number.isInteger(val) ? val : val.toFixed(1)}`,
                      kind: 'local',
                    })),
                  ],
                  selected: isActive,
                }
              })}
            />
          </div>
        )
      })()}

      {/* Styles popover */}
      {paraStylesPanelOpen && mode === 'paragraph' && fontName && (() => {
        const mobileRect = mobileStylesBtnRef.current?.getBoundingClientRect()
        const desktopRect = stylesPanelBtnRef.current?.getBoundingClientRect()
        const isMobile = mobileRect && mobileRect.width > 0
        const rect = isMobile ? mobileRect : desktopRect
        if (!rect) return null
        const margin = 16
        const popoverLeft = isMobile ? margin : rect.left
        const popoverRight = isMobile ? margin : undefined
        const caretX = isMobile
          ? rect.left + rect.width / 2 - margin
          : rect.width / 2
        return (
          <div
            ref={stylesPanelPopoverRef}
            className="para-styles-panel"
            style={{
              top: rect.bottom + 8,
              left: popoverLeft,
              ...(popoverRight !== undefined ? { right: popoverRight, minWidth: 'unset' } : {}),
              '--caret-x': `${caretX}px`,
            }}
          >
            {/* migrated to the shared StyleScopeList primitive (rows + chips); this
                panel keeps its own portal trigger/positioning */}
            <StyleScopeList
              inline
              mode="single"
              onSelect={type => setActiveParaStyle(prev => prev === type ? null : type)}
              rows={(['h1', 'h2', 'h3', 'p']).map(type => {
                const s = paraStyles[type]
                const merged = { ...axisValues, ...s.axisOverrides }
                const fvs = Object.entries(merged).map(([t, v]) => `"${t}" ${v}`).join(', ') || 'normal'
                return {
                  id: type,
                  label: type === 'p' ? 'Paragraph' : `Heading ${type[1]}`,
                  labelStyle: {
                    fontFamily: fontFace ? `"${fontFace.family}"` : 'serif',
                    fontStyle,
                    fontSize: `${Math.min(s.size, 22)}px`,
                    fontVariationSettings: fvs,
                    fontOpticalSizing: 'none',
                    fontSynthesis: 'none',
                    lineHeight: 1.3,
                  },
                  chips: [
                    { text: `${s.size}px`, kind: 'size' },
                    ...Object.entries(s.axisOverrides).map(([tag, val]) => ({
                      text: `${tag} ${val === 'auto' ? 'auto' : Number.isInteger(val) ? val : val.toFixed(1)}`,
                      kind: 'axis',
                    })),
                  ],
                  selected: activeParaStyle === type,
                }
              })}
            />
          </div>
        )
      })()}
    </div>
  )
}

// ── Cal.com preview ───────────────────────────────────────────────────────────
function CalcomPreview({ roleStyle, activeRole, onRoleClick }) {
  const [selectedDate, setSelectedDate] = useState(22)
  const [selectedDur, setSelectedDur] = useState(15)

  // April 2026: April 1 = Wednesday → startOffset 2 (Mon=0, Tue=1, Wed=2)
  const startOffset = 2
  const cells = []
  for (let i = 0; i < startOffset; i++) cells.push(null)
  for (let d = 1; d <= 30; d++) cells.push(d)
  while (cells.length % 7 !== 0) cells.push(null)

  const times = ['4:15am','4:20am','4:25am','4:30am','6:00am','6:05am','6:15am','6:30am','6:45am','7:00am','11:30am','1:15pm','1:30pm']

  const roleClass = (role) => activeRole === role ? 'calcom-role-highlight' : ''

  return (
    <div className="calcom-page">
      <div className="calcom-card">
        {/* Left panel */}
        <div className="calcom-left">
          <div className="calcom-cover">
            <div className="calcom-cover-img-wrap">
              <img src={calcomBanner} alt="" className="calcom-cover-img" />
            </div>
            <div className="calcom-avatar">
              <img src={peerAvatar} alt="Peer Richelsen" className="calcom-avatar-img" />
            </div>
          </div>
          <div className="calcom-left-body">
          <div className={`calcom-event-host ${roleClass('eventHost')}`} style={roleStyle('eventHost')}
            contentEditable suppressContentEditableWarning
            onClick={() => onRoleClick(r => r === 'eventHost' ? null : 'eventHost')}>
            Peer Richelsen
          </div>
          <div className={`calcom-event-title ${roleClass('eventTitle')}`} style={roleStyle('eventTitle')}
            contentEditable suppressContentEditableWarning
            onClick={() => onRoleClick(r => r === 'eventTitle' ? null : 'eventTitle')}>
            Meeting
          </div>
          <div className={`calcom-event-desc ${roleClass('eventDesc')}`} style={roleStyle('eventDesc')}
            contentEditable suppressContentEditableWarning
            onClick={() => onRoleClick(r => r === 'eventDesc' ? null : 'eventDesc')}>
            A quick screen share demo or longer conversation.
          </div>
          <div className={`calcom-meta-item ${roleClass('eventDesc')}`} style={roleStyle('eventDesc')}>
            <svg className="calcom-meta-icon-img" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="3" width="18" height="18" rx="2"/>
              <path d="m9 12 2 2 4-4"/>
            </svg>
            Requires confirmation
          </div>
          <div className={`calcom-meta-item ${roleClass('eventMeta')}`} style={roleStyle('eventMeta')}
            onClick={() => onRoleClick(r => r === 'eventMeta' ? null : 'eventMeta')}>
            <svg className="calcom-meta-icon-img" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10"/>
              <polyline points="12 6 12 12 16 14"/>
            </svg>
            <div className="calcom-durations">
              {[15, 30].map(d => (
                <button
                  key={d}
                  className={`calcom-dur-btn ${selectedDur === d ? 'active' : ''}`}
                  style={roleStyle('eventMeta')}
                  onClick={e => { e.stopPropagation(); setSelectedDur(d) }}
                >{d}m</button>
              ))}
            </div>
          </div>
          <div className={`calcom-meta-item ${roleClass('eventMeta')}`} style={roleStyle('eventMeta')}
            onClick={() => onRoleClick(r => r === 'eventMeta' ? null : 'eventMeta')}>
            <img src={calcomIcon} alt="" className="calcom-meta-icon-img" /> Cal Video
          </div>
          <div className={`calcom-meta-item ${roleClass('eventMeta')}`} style={roleStyle('eventMeta')}>
            <svg className="calcom-meta-icon-img" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10"/>
              <line x1="2" y1="12" x2="22" y2="12"/>
              <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>
            </svg>
            America/New York
          </div>
          </div>{/* end calcom-left-body */}
        </div>

        {/* Calendar panel */}
        <div className="calcom-right">
          <div className="calcom-calendar-wrap">
            <div className="calcom-month-nav">
              <div className="calcom-month-label">
                <span style={{...roleStyle('calHeader'), fontSize: '14px'}}>April</span>
                <span style={{...roleStyle('calHeader'), fontSize: '14px', color: 'rgba(245,250,255,0.4)'}}>2026</span>
              </div>
              <div className="calcom-nav-btns">
                <button className="calcom-nav-btn">‹</button>
                <button className="calcom-nav-btn">›</button>
              </div>
            </div>
            <div className="calcom-cal-grid">
              {['Mon','Tue','Wed','Thu','Fri','Sat','Sun'].map(d => (
                <div key={d} className={`calcom-weekday ${roleClass('calHeader')}`} style={roleStyle('calHeader')}
                  onClick={() => onRoleClick(r => r === 'calHeader' ? null : 'calHeader')}>
                  {d}
                </div>
              ))}
              {cells.map((day, i) => (
                <div
                  key={i}
                  className={`calcom-day${day === null ? ' empty' : ''}${day === 22 ? ' today' : ''}${day === selectedDate ? ' selected' : ''}${day !== null && day < 22 ? ' past' : ''} ${day !== null ? roleClass('calDay') : ''}`}
                  style={day !== null ? roleStyle('calDay') : {}}
                  onClick={() => {
                    if (day !== null && day >= 22) setSelectedDate(day)
                    onRoleClick(r => r === 'calDay' ? null : 'calDay')
                  }}
                >
                  {day}
                </div>
              ))}
            </div>
          </div>

          {/* Time slots */}
          {selectedDate && (
            <div className="calcom-times-wrap">
              <div className="calcom-time-date" style={{...roleStyle('calHeader'), fontSize: '14px', textTransform: 'none'}}>
                Wed {selectedDate}
              </div>
              <div className="calcom-time-list">
                {times.map(t => (
                  <button
                    key={t}
                    className={`calcom-time-btn ${roleClass('timeSlot')}`}
                    style={roleStyle('timeSlot')}
                    onClick={() => onRoleClick(r => r === 'timeSlot' ? null : 'timeSlot')}
                  >{t}</button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Booking Events (coss.com) preview ────────────────────────────────────────
function CossPreview({ roleStyle, activeRole, onRoleClick }) {
  const roleClass = (role) => activeRole === role ? 'calcom-role-highlight' : ''
  const [openMenu, setOpenMenu] = useState(null)
  const [cossPage, setCossPage] = useState('eventTypes')
  const [bookingsTab, setBookingsTab] = useState('past')

  useEffect(() => {
    if (openMenu === null) return
    const handler = (e) => {
      if (!e.target.closest('.coss-ctx-menu') && !e.target.closest('.coss-icon-btn--menu')) setOpenMenu(null)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [openMenu])

  const LucideIcon = ({ children }) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="coss-nav-icon" aria-hidden="true">{children}</svg>
  )

  const PAGED = new Set(['eventTypes', 'bookings'])
  const handleNavClick = (key) => {
    if (PAGED.has(key)) {
      if (cossPage !== key) { setCossPage(key); return }
    }
    onRoleClick(r => r === 'navLabel' ? null : 'navLabel')
  }

  const navItems = [
    { key: 'eventTypes', label: 'Event Types', icon: (
      <LucideIcon><path d="M9 17H7A5 5 0 0 1 7 7h2"/><path d="M15 7h2a5 5 0 0 1 0 10h-2"/><line x1="11" y1="12" x2="13" y2="12"/></LucideIcon>
    )},
    { key: 'bookings', label: 'Bookings', icon: (
      <LucideIcon><path d="M8 2v4"/><path d="M16 2v4"/><rect width="18" height="18" x="3" y="4" rx="2"/><path d="M3 10h18"/></LucideIcon>
    )},
    { key: 'availability', label: 'Availability', icon: (
      <LucideIcon><path d="M12 2a10 10 0 0 1 7.38 16.75"/><path d="M12 6v6l4 2"/><path d="M2.5 8.875a10 10 0 0 0-.5 3"/><path d="M2.83 16a10 10 0 0 0 2.43 3.4"/><path d="M4.636 5.235a10 10 0 0 1 .891-.857"/><path d="M8.644 21.42a10 10 0 0 0 7.631-.38"/></LucideIcon>
    )},
    { key: 'members', label: 'Members', icon: (
      <LucideIcon><path d="M16 2v2"/><path d="M17.915 22a6 6 0 0 0-12 0"/><path d="M8 2v2"/><circle cx="12" cy="12" r="4"/><rect x="3" y="4" width="18" height="18" rx="2"/></LucideIcon>
    )},
    { key: 'teams', label: 'Teams', icon: (
      <LucideIcon><path d="M18 21a8 8 0 0 0-16 0"/><circle cx="10" cy="8" r="5"/><path d="M22 20c0-3.37-2-6.5-4-8a5 5 0 0 0-.45-8.3"/></LucideIcon>
    )},
    { key: 'apps', label: 'Apps', chevron: true, icon: (
      <LucideIcon><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></LucideIcon>
    )},
    { key: 'routing', label: 'Routing', icon: (
      <LucideIcon><circle cx="6" cy="19" r="3"/><path d="M9 19h8.5a3.5 3.5 0 0 0 0-7h-11a3.5 3.5 0 0 1 0-7H15"/><circle cx="18" cy="5" r="3"/></LucideIcon>
    )},
    { key: 'workflows', label: 'Workflows', badge: 'Cal AI', icon: (
      <LucideIcon><rect width="8" height="8" x="3" y="3" rx="2"/><path d="M7 11v4a2 2 0 0 0 2 2h4"/><rect width="8" height="8" x="13" y="13" rx="2"/></LucideIcon>
    )},
    { key: 'insights', label: 'Insights', icon: (
      <LucideIcon><path d="M22 12h-2.48a2 2 0 0 0-1.93 1.46l-2.35 8.36a.25.25 0 0 1-.48 0L9.24 2.18a.25.25 0 0 0-.48 0l-2.35 8.36A2 2 0 0 1 4.49 12H2"/></LucideIcon>
    )},
  ]

  const eventTypes = [
    { id: 1, title: '15 Min Meeting', slug: '/pasquale/15min',  desc: 'A quick 15 minute call to discuss anything.', duration: '15m', badges: [], enabled: true },
    { id: 2, title: '30 Min Meeting', slug: '/pasquale/30min',  desc: 'A standard 30 minute meeting for detailed discussions.', duration: '30m', badges: [], enabled: true },
    { id: 3, title: '60 Min Consultation', slug: '/pasquale/consultation', desc: 'An in-depth consultation for complex topics requiring detailed discussion and planning.', duration: '1h', badges: ['confirmation'], enabled: true },
    { id: 4, title: 'Secret Meeting', slug: '/pasquale/secret', desc: 'A private meeting only accessible via direct link.', duration: '30m', badges: ['hidden'], enabled: false },
    { id: 5, title: 'Paid Consultation', slug: '/pasquale/paid-consultation', desc: 'Premium consultation with payment required.', duration: '45m', badges: ['paid'], enabled: true },
  ]

  return (
    <div className="coss-shell">
      {/* Mobile top bar */}
      <div className="coss-mobile-bar">
        <span className="coss-mobile-wordmark">Cal.com</span>
        <div className="coss-logo-actions">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="coss-logo-icon"><path d="m21 21-4.34-4.34"/><circle cx="11" cy="11" r="8"/></svg>
          <img src={cossCalAvatar} alt="" className="coss-avatar-img" />
        </div>
      </div>

      {/* Sidebar */}
      <aside className="coss-sidebar">
        <div className="coss-sidebar-top">
          <div className="coss-logo-row">
            <svg className="coss-wordmark" viewBox="0 0 1953.76354 400" fill="currentColor" xmlns="http://www.w3.org/2000/svg"><path d="M196.05736,399.28317C84.22939,399.28317,0,312.18638,0,204.65949,0,96.77419,79.92832,8.96057,196.05736,8.96057c61.64874,0,104.30107,18.638,137.63442,61.29033l-53.76344,44.08603c-22.58066-23.65591-49.8208-35.48388-83.87098-35.48388-75.62724,0-117.20431,56.98925-117.20431,125.80645s45.51972,124.7312,117.20431,124.7312c33.69176,0,62.3656-11.82797,84.94623-35.48388l53.04661,45.87815c-31.89965,40.86022-75.62726,59.4982-137.99284,59.4982Z"/><path d="M565.59139,112.90322h72.40142v279.5699h-72.40142v-40.86022c-15.05375,29.03225-40.14336,48.3871-88.17207,48.3871-76.70252,0-137.99284-65.59141-137.99284-146.23657s61.29032-146.23656,137.99284-146.23656c47.67026,0,73.11826,19.35484,88.17207,48.3871v-43.01074ZM567.74194,253.76345c0-43.72759-30.46595-79.92832-78.4946-79.92832-46.23654,0-76.3441,36.55914-76.3441,79.92832,0,42.29392,30.10751,79.9283,76.3441,79.9283,47.67021,0,78.4946-36.55913,78.4946-79.9283Z"/><path d="M689.2473,0h72.40142v392.11471h-72.40142V0Z"/><path d="M793.90685,355.19713c0-22.93907,18.63798-42.29392,44.08603-42.29392s43.36914,19.35484,43.36914,42.29392c0,23.65591-18.27959,43.01075-43.3692,43.01075s-44.08598-19.35482-44.08598-43.01075Z"/><path d="M1158.42292,347.31184c-26.88172,32.25807-67.74192,52.68816-116.12901,52.68816-86.37995,0-149.82075-65.59141-149.82075-146.23657s63.44091-146.23656,149.82075-146.23656c46.59498,0,87.09673,19.35484,113.97845,49.82078l-55.914,46.23657c-13.97847-17.2043-32.25807-30.10753-58.06456-30.10753-46.23654,0-76.34404,36.55913-76.34404,79.9283s30.10751,79.92833,76.34404,79.92833c27.95695,0,47.31187-14.33692,61.64879-33.69176l54.48033,47.67029Z"/><path d="M1164.51616,253.76345c0-80.64516,63.44091-146.23656,149.82075-146.23656s149.82075,65.5914,149.82075,146.23656-63.44091,146.23655-149.82075,146.23655c-86.37984-.35842-149.82075-65.59138-149.82075-146.23655ZM1390.68106,253.76345c0-43.72759-30.10751-79.92832-76.34404-79.92832-46.23665-.35843-76.34415,36.2007-76.34415,79.92832,0,43.36917,30.10751,79.9283,76.34404,79.9283s76.34415-36.55913,76.34415-79.9283Z"/><path d="M1953.76354,221.50539v170.60932h-72.40148v-153.04659c0-48.3871-22.93916-69.17563-57.34767-69.17563-32.25807,0-55.19711,15.77062-55.19711,69.17563v153.04659h-72.40148v-153.04659c0-48.3871-23.29749-69.17563-57.34767-69.17563-32.25807,0-60.57346,15.77062-60.57346,69.17563v153.04659h-72.40148V112.5448h72.40148v38.70968c15.05381-30.10752,42.29386-45.1613,84.22939-45.1613,39.78497,0,73.11826,19.35484,91.39785,51.97133,18.27959-33.33333,45.1612-51.97133,93.90686-51.97133,59.49812.35843,105.73477,44.80288,105.73477,115.41221Z"/></svg>
            <div className="coss-logo-actions">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="coss-logo-icon"><path d="m21 21-4.34-4.34"/><circle cx="11" cy="11" r="8"/></svg>
              <img src={cossCalAvatar} alt="" className="coss-avatar-img" />
              <img src={cossUserAvatar} alt="" className="coss-avatar-img" />
            </div>
          </div>
          <nav className="coss-nav">
            {navItems.map(item => (
              <button
                key={item.key}
                className={`coss-nav-item ${cossPage === item.key ? 'active' : ''} ${roleClass('navLabel')}`}
                style={roleStyle('navLabel')}
                onClick={() => handleNavClick(item.key)}
              >
                {item.icon}
                <span>{item.label}</span>
                {item.badge && (
                  <span className="coss-ai-badge">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="coss-sparkle-icon"><path d="M11.017 2.814a1 1 0 0 1 1.966 0l1.051 5.558a2 2 0 0 0 1.594 1.594l5.558 1.051a1 1 0 0 1 0 1.966l-5.558 1.051a2 2 0 0 0-1.594 1.594l-1.051 5.558a1 1 0 0 1-1.966 0l-1.051-5.558a2 2 0 0 0-1.594-1.594l-5.558-1.051a1 1 0 0 1 0-1.966l5.558-1.051a2 2 0 0 0 1.594-1.594z"/><path d="M20 2v4"/><path d="M22 4h-4"/><circle cx="4" cy="20" r="2"/></svg>
                    {item.badge}
                  </span>
                )}
                {item.chevron && <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="coss-nav-chevron"><path d="m9 18 6-6-6-6"/></svg>}
              </button>
            ))}
          </nav>
        </div>
        <div className="coss-sidebar-bottom">
          {[
            { label: 'View public page',      icon: <><path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/></> },
            { label: 'Copy public page link', icon: <><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></> },
            { label: 'Refer and earn',        icon: <><rect x="3" y="8" width="18" height="4" rx="1"/><path d="M12 8v13"/><path d="M19 12v7a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-7"/><path d="M7.5 8a2.5 2.5 0 0 1 0-5A4.8 8 0 0 1 12 8a4.8 8 0 0 1 4.5-5 2.5 2.5 0 0 1 0 5"/></> },
            { label: 'Settings',              icon: <><path d="M9.671 4.136a2.34 2.34 0 0 1 4.659 0 2.34 2.34 0 0 0 3.319 1.915 2.34 2.34 0 0 1 2.33 4.033 2.34 2.34 0 0 0 0 3.831 2.34 2.34 0 0 1-2.33 4.033 2.34 2.34 0 0 0-3.319 1.915 2.34 2.34 0 0 1-4.659 0 2.34 2.34 0 0 0-3.32-1.915 2.34 2.34 0 0 1-2.33-4.033 2.34 2.34 0 0 0 0-3.831A2.34 2.34 0 0 1 6.35 6.051a2.34 2.34 0 0 0 3.319-1.915"/><circle cx="12" cy="12" r="3"/></> },
          ].map(({ label, icon }) => (
            <button key={label} className={`coss-sidebar-link ${roleClass('navLabel')}`} style={roleStyle('navLabel')}
              onClick={() => onRoleClick(r => r === 'navLabel' ? null : 'navLabel')}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="coss-nav-icon">{icon}</svg>
              {label}
            </button>
          ))}
        </div>
      </aside>

      {/* Main content */}
      <main className="coss-main">
        {/* ── Event Types page ── */}
        {cossPage === 'eventTypes' && (<>
        <div className="coss-page-header">
          <div>
            <div className={`coss-page-title ${roleClass('pageTitle')}`} style={roleStyle('pageTitle')}
              onClick={() => onRoleClick(r => r === 'pageTitle' ? null : 'pageTitle')}>
              Event Types
            </div>
            <div className={`coss-page-sub ${roleClass('cardDesc')}`} style={roleStyle('cardDesc')}
              onClick={() => onRoleClick(r => r === 'cardDesc' ? null : 'cardDesc')}>
              Create events to share for people to book on your calendar.
            </div>
          </div>
          <div className="coss-header-actions">
            <div className="coss-search-bar">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="coss-search-icon"><path d="m21 21-4.34-4.34"/><circle cx="11" cy="11" r="8"/></svg>
            </div>
            <button className="coss-new-btn">+ New</button>
          </div>
        </div>

        <div className="coss-card-list">
          {eventTypes.map(et => (
            <div key={et.id} className={`coss-event-card${et.badges.includes('paid') ? ' coss-event-card--paid' : et.badges.includes('hidden') ? ' coss-event-card--hidden' : ''}`}>
              <div className="coss-card-left">
                <div className="coss-card-title-row">
                  <span className={`coss-card-title ${roleClass('cardTitle')}`} style={roleStyle('cardTitle')}
                    onClick={() => onRoleClick(r => r === 'cardTitle' ? null : 'cardTitle')}>
                    {et.title}
                  </span>
                  <span className={`coss-card-slug ${roleClass('cardSlug')}`} style={roleStyle('cardSlug')}
                    onClick={() => onRoleClick(r => r === 'cardSlug' ? null : 'cardSlug')}>
                    {et.slug}
                  </span>
                </div>
                <div className={`coss-card-desc ${roleClass('cardDesc')}`} style={roleStyle('cardDesc')}
                  onClick={() => onRoleClick(r => r === 'cardDesc' ? null : 'cardDesc')}>
                  {et.desc}
                </div>
                <div className="coss-card-badges">
                  <span className={`coss-badge coss-badge--duration ${roleClass('badge')}`} style={roleStyle('badge')}
                    onClick={() => onRoleClick(r => r === 'badge' ? null : 'badge')}>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="coss-badge-icon"><path d="M12 6v6l4 2"/><circle cx="12" cy="12" r="10"/></svg>
                    {et.duration}
                  </span>
                  {et.badges.includes('confirmation') && (
                    <span className={`coss-badge coss-badge--confirm ${roleClass('badge')}`} style={roleStyle('badge')}
                      onClick={() => onRoleClick(r => r === 'badge' ? null : 'badge')}>
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="coss-badge-icon"><rect width="8" height="4" x="8" y="2" rx="1" ry="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><path d="m9 14 2 2 4-4"/></svg>
                      Requires confirmation
                    </span>
                  )}
                  {et.badges.includes('hidden') && (
                    <span className={`coss-badge coss-badge--hidden ${roleClass('badge')}`} style={roleStyle('badge')}
                      onClick={() => onRoleClick(r => r === 'badge' ? null : 'badge')}>
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="coss-badge-icon"><path d="M10.733 5.076a10.744 10.744 0 0 1 11.205 6.575 1 1 0 0 1 0 .696 10.8 10.8 0 0 1-1.444 2.49M14.084 14.158a3 3 0 0 1-4.242-4.242"/><path d="M17.479 17.499a10.75 10.75 0 0 1-15.417-5.151 1 1 0 0 1 0-.696 10.75 10.75 0 0 1 4.446-5.143M2 2l20 20"/></svg>
                      Hidden
                    </span>
                  )}
                  {et.badges.includes('paid') && (
                    <span className={`coss-badge coss-badge--paid ${roleClass('badge')}`} style={roleStyle('badge')}
                      onClick={() => onRoleClick(r => r === 'badge' ? null : 'badge')}>
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="coss-badge-icon"><rect width="20" height="12" x="2" y="6" rx="2"/><circle cx="12" cy="12" r="2"/><path d="M6 12h.01M18 12h.01"/></svg>
                      $99
                    </span>
                  )}
                </div>
              </div>
              <div className="coss-card-right">
                <div className={`coss-toggle ${et.enabled ? 'on' : 'off'}`}>
                  <div className="coss-toggle-thumb" />
                </div>
                <button className="coss-icon-btn">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/></svg>
                </button>
                <div className="coss-menu-wrap">
                  <button
                    className={`coss-icon-btn coss-icon-btn--menu ${openMenu === et.id ? 'active' : ''}`}
                    onClick={e => { e.stopPropagation(); setOpenMenu(openMenu === et.id ? null : et.id) }}
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/></svg>
                  </button>
                  {openMenu === et.id && (
                    <div className="coss-ctx-menu">
                      <div className="coss-ctx-section">Edit event</div>
                      <button className="coss-ctx-item">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="coss-ctx-icon"><path d="M8 2v4"/><path d="M16 2v4"/><rect width="18" height="18" x="3" y="4" rx="2"/><path d="M3 10h18"/></svg>
                        Reschedule booking
                      </button>
                      <button className="coss-ctx-item coss-ctx-item--muted">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="coss-ctx-icon"><path d="M8 2v4"/><path d="M16 2v4"/><rect width="18" height="18" x="3" y="4" rx="2"/><path d="M3 10h18"/></svg>
                        Request reschedule
                      </button>
                      <button className="coss-ctx-item">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="coss-ctx-icon"><path d="M20 10c0 4.418-8 12-8 12s-8-7.582-8-12a8 8 0 0 1 16 0z"/><circle cx="12" cy="10" r="3"/></svg>
                        Edit location
                      </button>
                      <button className="coss-ctx-item">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="coss-ctx-icon"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><line x1="19" y1="8" x2="19" y2="14"/><line x1="22" y1="11" x2="16" y2="11"/></svg>
                        Add guests
                      </button>
                      <div className="coss-ctx-divider" />
                      <div className="coss-ctx-section">After event</div>
                      <button className="coss-ctx-item">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="coss-ctx-icon"><circle cx="12" cy="12" r="10"/><polygon points="10 8 16 12 10 16 10 8"/></svg>
                        View recordings
                      </button>
                      <button className="coss-ctx-item">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="coss-ctx-icon"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
                        View Session Details
                      </button>
                      <button className="coss-ctx-item">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="coss-ctx-icon"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
                        Mark as no-show
                      </button>
                      <div className="coss-ctx-divider" />
                      <button className="coss-ctx-item coss-ctx-item--danger">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="coss-ctx-icon"><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" y1="22" x2="4" y2="15"/></svg>
                        Report booking
                      </button>
                      <div className="coss-ctx-divider" />
                      <button className="coss-ctx-item coss-ctx-item--danger">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="coss-ctx-icon"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                        Cancel event
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </div>
          ))}
          <div className={`coss-no-more ${roleClass('cardDesc')}`} style={roleStyle('cardDesc')}>
            No more results
          </div>
        </div>
        </>)}

        {/* ── Bookings page ── */}
        {cossPage === 'bookings' && (<>
        <div className="coss-page-header">
          <div>
            <div className={`coss-page-title ${roleClass('pageTitle')}`} style={roleStyle('pageTitle')}
              onClick={() => onRoleClick(r => r === 'pageTitle' ? null : 'pageTitle')}>
              Bookings
            </div>
            <div className={`coss-page-sub ${roleClass('cardDesc')}`} style={roleStyle('cardDesc')}
              onClick={() => onRoleClick(r => r === 'cardDesc' ? null : 'cardDesc')}>
              See upcoming and past events booked through your event type links.
            </div>
          </div>
        </div>
        <div className="coss-bookings-tabs-row">
          <div className="coss-bookings-tabs">
            {['Upcoming','Unconfirmed','Recurring','Past','Cancelled'].map(t => (
              <button key={t}
                className={`coss-bookings-tab ${roleClass('badge')} ${bookingsTab === t.toLowerCase() ? 'active' : ''}`}
                style={roleStyle('badge')}
                onClick={() => { setBookingsTab(t.toLowerCase()); onRoleClick(r => r === 'badge' ? null : 'badge') }}>
                {t}
              </button>
            ))}
          </div>
          <button className="coss-bookings-filter-btn">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="13" height="13"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/><line x1="20" y1="20" x2="20" y2="14"/><line x1="17" y1="17" x2="23" y2="17"/></svg>
            Add Filter
          </button>
        </div>
        {bookingsTab === 'upcoming' ? (
          <div className="coss-bookings-empty">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="coss-empty-icon"><path d="M8 2v4"/><path d="M16 2v4"/><rect width="18" height="18" x="3" y="4" rx="2"/><path d="M3 10h18"/></svg>
            <div className={`coss-empty-title ${roleClass('cardTitle')}`} style={roleStyle('cardTitle')}
              onClick={() => onRoleClick(r => r === 'cardTitle' ? null : 'cardTitle')}>
              No upcoming bookings
            </div>
            <div className={`coss-empty-sub ${roleClass('cardDesc')}`} style={roleStyle('cardDesc')}
              onClick={() => onRoleClick(r => r === 'cardDesc' ? null : 'cardDesc')}>
              You have no upcoming bookings found. As soon as someone books a time with you, it will show up here.
            </div>
          </div>
        ) : (
          <div className="coss-booking-list">
            {[
              { date: 'November 25, 2025', time: '2:40 PM – 3:00 PM', title: 'Engineering Chat between Keith Williams and Pasquale Vitiello', people: 'Keith Williams and Pasquale Vitiello', platform: 'Cal Video', badge: 'Rescheduled', accent: false },
              { date: 'November 7, 2025',  time: '11:30 AM – 12:00 PM', title: 'Platform onboarding roadmap', people: 'Carina Wollheim, Jonathan Djalo and Pasquale Vitiello', platform: 'Cal Video', badge: null, accent: true },
              { date: 'November 6, 2025',  time: '3:00 PM – 3:20 PM', title: 'Engineering Chat between Keith Williams and Pasquale Vitiello', people: 'Keith Williams and Pasquale Vitiello', platform: 'Cal Video', badge: null, accent: false },
              { date: 'November 3, 2025',  time: '3:00 PM – 3:30 PM', title: '30 Min Meeting between Susan Moeller and Pasquale Vitiello', people: 'Susan Moeller and Pasquale Vitiello', platform: 'Cal Video', badge: null, accent: false },
              { date: 'October 13, 2025',  time: '3:30 PM – 4:00 PM', title: '30 Min Meeting between Pasquale Vitiello and David Borenius', people: 'Pasquale Vitiello and David Borenius', platform: 'Google Meet', badge: 'Rescheduled', accent: false },
              { date: 'October 10, 2025',  time: '5:00 PM – 5:30 PM', title: '@cossful migration', people: 'Peer Richelsen, Keith Williams and Pasquale Vitiello', platform: 'Google Meet', badge: null, accent: false, calBadge: true },
            ].map((b, i) => (
              <div key={i} className={`coss-booking-row ${b.accent ? 'accent' : ''}`}>
                <div className="coss-booking-grid">
                  {/* row 1: date | title */}
                  <div className={`coss-booking-date-label ${roleClass('cardSlug')}`} style={roleStyle('cardSlug')}
                    onClick={() => onRoleClick(r => r === 'cardSlug' ? null : 'cardSlug')}>
                    {b.date}
                  </div>
                  <div className={`coss-booking-title ${roleClass('cardTitle')}`} style={roleStyle('cardTitle')}
                    onClick={() => onRoleClick(r => r === 'cardTitle' ? null : 'cardTitle')}>
                    {b.title}
                  </div>
                  {/* row 2: time | people */}
                  <div className={`coss-booking-time ${roleClass('cardSlug')}`} style={roleStyle('cardSlug')}
                    onClick={() => onRoleClick(r => r === 'cardSlug' ? null : 'cardSlug')}>
                    {b.time}
                  </div>
                  <div className={`coss-booking-people ${roleClass('cardDesc')}`} style={roleStyle('cardDesc')}
                    onClick={() => onRoleClick(r => r === 'cardDesc' ? null : 'cardDesc')}>
                    {b.people}
                  </div>
                  {/* row 3: platform badge | status badges */}
                  <div className="coss-booking-left-badge">
                    {b.platform && (
                      <span className={`coss-badge coss-badge--platform ${roleClass('badge')}`} style={roleStyle('badge')}
                        onClick={e => { e.stopPropagation(); onRoleClick(r => r === 'badge' ? null : 'badge') }}>
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="coss-badge-icon"><path d="M15 10l4.553-2.069A1 1 0 0 1 21 8.82v6.361a1 1 0 0 1-1.447.894L15 14M3 8a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8z"/></svg>
                        {b.platform === 'Cal Video' ? 'Join Cal Video' : `Join ${b.platform}`}
                      </span>
                    )}
                  </div>
                  <div className="coss-booking-badges">
                    {b.badge && (
                      <span className={`coss-badge coss-badge--reschedule ${roleClass('badge')}`} style={roleStyle('badge')}
                        onClick={() => onRoleClick(r => r === 'badge' ? null : 'badge')}>
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="coss-badge-icon"><path d="M1 4v6h6"/><path d="M3.51 15a9 9 0 1 0 .49-3"/></svg>
                        {b.badge}
                      </span>
                    )}
                    {b.calBadge && (
                      <span className={`coss-badge coss-badge--cal ${roleClass('badge')}`} style={roleStyle('badge')}
                        onClick={() => onRoleClick(r => r === 'badge' ? null : 'badge')}>
                        Cal.com
                      </span>
                    )}
                  </div>
                </div>
                <button className="coss-icon-btn" style={{alignSelf:'flex-start', marginTop: 2}}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/></svg>
                </button>
              </div>
            ))}
          </div>
        )}
        </>)}

      </main>

      {/* Mobile bottom nav */}
      <nav className="coss-bottom-nav">
        <button className="coss-bottom-btn">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>
        </button>
        <button className="coss-bottom-btn">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M8 2v4"/><path d="M16 2v4"/><rect width="18" height="18" x="3" y="4" rx="2"/><path d="M3 10h18"/></svg>
        </button>
        <button className="coss-bottom-btn">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
        </button>
        <button className="coss-bottom-btn">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/></svg>
        </button>
        <button className="coss-bottom-btn coss-bottom-btn--fab">+</button>
      </nav>
    </div>
  )
}

// ── Theme Toggle ──────────────────────────────────────────────────────────────
function ThemeToggle() {
  const [theme, setTheme] = useState(() => localStorage.getItem('wm-theme') || 'auto')
  const apply = (t) => {
    setTheme(t)
    localStorage.setItem('wm-theme', t)
    document.documentElement.dataset.theme = t
  }
  return (
    <div id="theme-toggle" role="group" aria-label="Colour scheme">
      {['auto', 'light', 'dark'].map(t => (
        <button key={t} data-mode={t} className={theme === t ? 'active' : ''} onClick={() => apply(t)}>
          {t.charAt(0).toUpperCase() + t.slice(1)}
        </button>
      ))}
    </div>
  )
}

// ── Icons ─────────────────────────────────────────────────────────────────────
function CalIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 20 20" fill="none">
      <rect width="20" height="20" rx="3" ry="3" fill="currentColor" fillOpacity="0.15"/>
      <path fill="currentColor" d="M5.155 12.422c-.43-.25-.769-.587-1.016-1.012-.247-.425-.371-.893-.371-1.402 0-.515.12-.987.36-1.417.24-.43.574-.77 1.001-1.02.427-.25.914-.375 1.459-.375.405 0 .777.071 1.117.214.34.143.635.358.885.648l-.772.735c-.17-.18-.35-.314-.54-.401-.19-.087-.42-.131-.69-.131-.345 0-.646.076-.904.229-.257.153-.456.361-.596.626-.14.265-.21.562-.21.892 0 .33.07.625.21.885.14.26.341.465.604.615.262.15.568.225.918.225.235 0 .456-.042.664-.128.207-.085.383-.21.529-.375l.795.698c-.22.265-.498.476-.832.633-.335.157-.728.236-1.177.236-.525 0-1.002-.125-1.432-.375ZM9.835 12.516c-.3-.193-.534-.449-.701-.769-.168-.32-.251-.665-.251-1.035 0-.37.084-.715.251-1.035.167-.32.401-.576.701-.769.3-.193.64-.289 1.02-.289.285 0 .542.064.772.191.23.128.383.3.458.514h.052v-.6h1.027v3.974h-1.027v-.585h-.052c-.075.205-.228.371-.458.499-.23.127-.487.191-.772.191-.38 0-.72-.096-1.02-.288Zm1.743-.833c.162-.097.29-.231.382-.401.092-.17.139-.36.139-.57 0-.215-.047-.407-.139-.577-.092-.17-.22-.304-.382-.401-.163-.097-.346-.146-.551-.146-.31 0-.568.106-.772.319-.205.213-.307.478-.307.799 0 .21.046.401.139.574.092.172.221.307.386.405.165.097.35.146.555.146.205 0 .389-.049.551-.146ZM15.391 12.7h-1.057v-.877l.007-4.53h1.058l-.008 5.406Z"/>
    </svg>
  )
}
function BigIcon({ className }) {
  return <svg className={className} width="20" height="14" viewBox="0 0 20 14" fill="none"><text x="10" y="12" textAnchor="middle" fontSize="13" fill="currentColor" fontFamily="'CalSansUI', system-ui, sans-serif" style={{fontSynthesis:'none'}}>Aa</text></svg>
}
function ParaIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
      <rect x="1" y="2" width="12" height="1.5" rx="0.75" fill="currentColor"/>
      <rect x="1" y="5.5" width="12" height="1.5" rx="0.75" fill="currentColor"/>
      <rect x="1" y="9" width="8" height="1.5" rx="0.75" fill="currentColor"/>
    </svg>
  )
}
function GlyphIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
      <rect x="1" y="1" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.2"/>
      <rect x="8" y="1" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.2"/>
      <rect x="1" y="8" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.2"/>
      <rect x="8" y="8" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.2"/>
    </svg>
  )
}
function ScaleIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
      <rect x="1" y="1.5" width="12" height="3" rx="0.75" fill="currentColor"/>
      <rect x="1" y="6.5" width="12" height="2" rx="0.75" fill="currentColor"/>
      <rect x="1" y="10.5" width="12" height="1.25" rx="0.625" fill="currentColor"/>
    </svg>
  )
}
function SlidersIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
      <line x1="1" y1="3" x2="11" y2="3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
      <circle cx="4" cy="3" r="1.5" fill="currentColor"/>
      <line x1="1" y1="9" x2="11" y2="9" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
      <circle cx="8" cy="9" r="1.5" fill="currentColor"/>
    </svg>
  )
}
function AlignLeftIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
      <rect x="1" y="2" width="12" height="1.4" rx="0.7" fill="currentColor"/>
      <rect x="1" y="5.5" width="8" height="1.4" rx="0.7" fill="currentColor"/>
      <rect x="1" y="9" width="10" height="1.4" rx="0.7" fill="currentColor"/>
    </svg>
  )
}
function AlignCenterIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
      <rect x="1" y="2" width="12" height="1.4" rx="0.7" fill="currentColor"/>
      <rect x="3" y="5.5" width="8" height="1.4" rx="0.7" fill="currentColor"/>
      <rect x="2" y="9" width="10" height="1.4" rx="0.7" fill="currentColor"/>
    </svg>
  )
}
function AlignRightIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
      <rect x="1" y="2" width="12" height="1.4" rx="0.7" fill="currentColor"/>
      <rect x="5" y="5.5" width="8" height="1.4" rx="0.7" fill="currentColor"/>
      <rect x="3" y="9" width="10" height="1.4" rx="0.7" fill="currentColor"/>
    </svg>
  )
}
function ChevronLeftIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="9,2 4,7 9,12" />
    </svg>
  )
}

function ChevronRightIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="5,2 10,7 5,12" />
    </svg>
  )
}

function ChevronDownIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="3,6 8,11 13,6" />
    </svg>
  )
}

function ChevronUpIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="3,10 8,5 13,10" />
    </svg>
  )
}

function MultiSelectIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true">
      <circle cx="3" cy="4" r="1.5" />
      <line x1="6.5" y1="4" x2="12" y2="4" />
      <circle cx="3" cy="10" r="1.5" />
      <line x1="6.5" y1="10" x2="12" y2="10" />
    </svg>
  )
}

function ResetIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width="16" height="16" fill="currentColor" aria-hidden="true">
      <defs>
        <style>{`.rst0{stroke-miterlimit:10}.rst0,.rst1{display:none;fill:none;stroke:currentColor;stroke-linecap:round;stroke-width:1.4px}.rst1{stroke-linejoin:round}`}</style>
      </defs>
      <path className="rst0" d="M8,2.39906c3.09331,0,5.60094,2.50763,5.60094,5.60094s-2.50763,5.60094-5.60094,5.60094-5.60094-2.50763-5.60094-5.60094c0-1.74259.7958-3.29931,2.04381-4.32656"/>
      <polyline className="rst1" points="2.04069 3.38941 4.84717 3.38941 4.84717 6.19617"/>
      <path d="M8,14.2909c-3.47461,0-6.30127-2.81629-6.30127-6.2909,0-2.57326,1.51851-3.90145,2.46222-4.67831.19366-.15897.47817-.12995.6365.06182.15865.19272.10866.45416-.06182.6365-.72266.77296-1.63651,1.99428-1.63651,3.97999,0,2.70215,2.19824,4.91247,4.90088,4.91247,2.70215,0,4.90039-2.21033,4.90039-4.91247,0-2.70264-2.19824-4.90088-4.90039-4.90088-.38672,0-.7002-.31348-.7002-.7002s.31348-.7002.7002-.7002c3.47461,0,6.30078,2.82666,6.30078,6.30127s-2.82617,6.2909-6.30078,6.2909Z"/>
      <path d="M4.84717,6.89648c-.38672,0-.7002-.31348-.7002-.7002v-2.12169h-2.10645c-.38672,0-.7002-.31032-.7002-.69704s.31348-.68811.7002-.68811h2.80664c.38672,0,.7002.31348.7002.7002v2.80664c0,.38672-.31348.7002-.7002.7002Z"/>
    </svg>
  )
}
