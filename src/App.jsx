import { useState, useRef, useEffect, useCallback } from 'react'
import './App.css'
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
  const [clientSlug, fontSlug] = segments
  return { clientSlug: clientSlug || null, fontSlug: fontSlug || null }
}

function toDisplayName(slug) {
  return slug.split('-').map(w => w[0].toUpperCase() + w.slice(1)).join(' ')
}

// ── Font fuzzy matching ──────────────────────────────────────────────────────
const fontModules = import.meta.glob('/src/fonts/*.{ttf,otf,woff,woff2}', { eager: true, query: '?url', import: 'default' })

function normalize(s) {
  return s.toLowerCase().replace(/[-_\s]/g, '').replace(/var|demo|variable|display|text/g, '')
}

// ── Special built-in fonts (UI fonts, not from src/fonts/) ───────────────────
const SPECIAL_FONTS = {
  calsansui: { name: 'CalSansUI' },
  calsans:   { name: 'Cal Sans (UI)' },
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
    { type: 'h2', text: 'Chapter I' },
    { type: 'h1', text: 'A Tale of Two Cities' },
    { type: 'p',  text: 'It was the best of times, it was the worst of times, it was the age of wisdom, it was the age of foolishness, it was the epoch of belief, it was the epoch of incredulity, it was the season of Light, it was the season of Darkness, it was the spring of hope, it was the winter of despair, we had everything before us, we had nothing before us, we were all going direct to Heaven, we were all going direct the other way—in short, the period was so far like the present period, that some of its noisiest authorities insisted on its being received, for good or for evil, in the superlative degree of comparison only.' },
    { type: 'p',  text: 'There were a king with a large jaw and a queen with a plain face, on the throne of England; there were a king with a large jaw and a queen with a fair face, on the throne of France. In both countries it was clearer than crystal to the lords of the State preserves of loaves and fishes, that things in general were settled for ever.' },
    { type: 'p',  text: 'It was the year of Our Lord one thousand seven hundred and seventy-five. Spiritual revelations were conceded to England at that favoured period, as at this. Mrs. Southcott had recently attained her five-and-twentieth blessed birthday, of whom a prophetic private in the Life Guards had heralded the sublime appearance by announcing that arrangements were made for the swallowing up of London and Westminster. Even the Cock-lane ghost had been laid only a round dozen of years, after rapping out its messages, as the spirits of this very year last past (supernaturally deficient in originality) rapped out theirs. Mere messages in the earthly order of events had lately come to the English Crown and People, from a congress of British subjects in America: which, strange to relate, have proved more important to the human race than any communications yet received through any of the chickens of the Cock-lane brood.' },
    { type: 'p',  text: 'France, less favoured on the whole as to matters spiritual than her sister of the shield and trident, rolled with exceeding smoothness down hill, making paper money and spending it. Under the guidance of her Christian pastors, she entertained herself, besides, with such humane achievements as sentencing a youth to have his hands cut off, his tongue torn out with pincers, and his body burned alive, because he had not kneeled down in the rain to do honour to a dirty procession of monks which passed within his view, at a distance of some fifty or sixty yards. It is likely enough that, rooted in the woods of France and Norway, there were growing trees, when that sufferer was put to death, already marked by the Woodman, Fate, to come down and be sawn into boards, to make a certain movable framework with a sack and a knife in it, terrible in history. It is likely enough that in the rough outhouses of some tillers of the heavy lands adjacent to Paris, there were sheltered from the weather that very day, rude carts, bespattered with rustic mire, snuffed about by pigs, and roosted in by poultry, which the Farmer, Death, had already set apart to be his tumbrils of the Revolution. But that Woodman and that Farmer, though they work unceasingly, work silently, and no one heard them as they went about with muffled tread: the rather, forasmuch as to entertain any suspicion that they were awake, was to be atheistical and traitorous.' },
    { type: 'p',  text: 'In England, there was scarcely an amount of order and protection to justify much national boasting. Daring burglaries by armed men, and highway robberies, took place in the capital itself every night; families were publicly cautioned not to go out of town without removing their furniture to upholsterers\' warehouses for security; the highwayman in the dark was a City tradesman in the light, and, being recognised and challenged by his fellow-tradesman whom he stopped in his character of "the Captain," gallantly shot him through the head and rode away; the mail was waylaid by seven robbers, and the guard shot three dead, and then got shot dead himself by the other four, "in consequence of the failure of his ammunition:" after which the mail was robbed in peace; that magnificent potentate, the Lord Mayor of London, was made to stand and deliver on Turnham Green, by one highwayman, who despoiled the illustrious creature in sight of all his retinue; prisoners in London gaols fought battles with their turnkeys, and the majesty of the law fired blunderbusses in among them, loaded with rounds of shot and ball; thieves snipped off diamond crosses from the necks of noble lords at Court drawing-rooms; musketeers went into St. Giles\'s, to search for contraband goods, and the mob fired on the musketeers, and the musketeers fired on the mob, and nobody thought any of these occurrences much out of the common way. In the midst of them, the hangman, ever busy and ever worse than useless, was in constant requisition; now, stringing up long rows of miscellaneous criminals; now, hanging a housebreaker on Saturday who had been taken on Tuesday; now, burning people in the hand at Newgate by the dozen, and now burning pamphlets at the door of Westminster Hall; to-day, taking the life of an atrocious murderer, and to-morrow of a wretched pilferer who had robbed a farmer\'s boy of sixpence.' },
    { type: 'p',  text: 'All these things, and a thousand like them, came to pass in and close upon the dear old year one thousand seven hundred and seventy-five. Environed by them, while the Woodman and the Farmer worked unheeded, those two of the large jaws, and those other two of the plain and the fair faces, trod with stir enough, and carried their divine rights with a high hand. Thus did the year one thousand seven hundred and seventy-five conduct their Greatnesses, and myriads of small creatures—the creatures of this chronicle among the rest—along the roads that lay before them.' },
    { type: 'h2', text: 'Chapter II — The Mail' },
    { type: 'p',  text: 'It was the Dover road that lay, on a Friday night late in November, before the first of the persons with whom this history has business. The Dover road lay, as to him, beyond the Dover mail, as it lumbered up Shooter\'s Hill. He walked up hill in the mire by the side of the mail, as the rest of the passengers did; not because they had the least relish for walking exercise, under the circumstances, but because the hill, and the harness, and the mud, and the mail, were all so heavy, that the horses had three times already come to a stop, besides once drawing the coach across the road, with the mutinous intent of taking it back to Blackheath. Reins and whip and coachman and guard, however, in combination, had read that article of war which forbade a purpose otherwise strongly in favour of the argument, that some brute animals are endued with Reason; and the team had capitulated and returned to their duty.' },
    { type: 'p',  text: 'With drooping heads and tremulous tails, they mashed their way through the thick mud, floundering and stumbling between whiles, as if they were falling to pieces at the larger joints. As often as the driver rested them and brought them to a stand, with a wary "Wo-ho! so-ho-then!" the near leader violently shook his head and everything upon it—like an unusually emphatic horse, denying that the coach could be got up the hill. Whenever the leader made this rattle, the passenger started, as a nervous passenger might, and was disturbed in mind.' },
    { type: 'p',  text: 'There was a steaming mist in all the hollows, and it had roamed in its forlornness up the hill, like an evil spirit, seeking rest and finding none. A clammy and intensely cold mist, it made its slow way through the air in ripples that visibly followed and overspread one another, as the waves of an unwholesome sea might do. It was dense enough to shut out everything from the light of the coach-lamps but these its own workings, and a few yards of road; and the reek of the labouring horses steamed into it, as if they had made it all.' },
    { type: 'p',  text: 'Two other passengers, besides the one, were plodding up the hill by the side of the mail. All three were wrapped to the cheekbones and over the ears, and wore jack-boots. Not one of the three could have said, from anything he saw, what either of the other two was like; and each was hidden under almost as many wrappers from the eyes of the mind, as from the eyes of the body, of his two companions. In those days, travellers were very shy of being confidential on a short notice, for anybody on the road might be a robber or in league with robbers. As to the latter, when every posting-house and ale-house could produce somebody in "the Captain\'s" pay, ranging from the landlord to the lowest stable non-descript, it was the likeliest thing upon the cards. So the guard of the Dover mail thought to himself, that Friday night in November, one thousand seven hundred and seventy-five, lumbering up Shooter\'s Hill, as he stood on his own particular perch behind the mail, beating his feet, and keeping an eye and a hand on the arm-chest before him, where a loaded blunderbuss lay at the top of six or eight loaded horse-pistols, deposited on a substratum of cutlass.' },
    { type: 'p',  text: 'The Dover mail was in its usual genial position that the guard suspected the passengers, the passengers suspected one another and the guard, they all suspected everybody else, and the coachman was sure of nothing but the horses; as to which cattle he could with a clear conscience have taken his oath on the two Testaments that they were not fit for the journey.' },
    { type: 'p',  text: '"Wo-ho!" said the coachman. "So, then! One more pull and you\'re at the top and be damned to you, for I have had trouble enough to get you to it!—Joe!" "Halloa!" the guard replied. "What o\'clock do you make it, Joe?" "Ten minutes, good, past eleven." "My blood!" ejaculated the vexed coachman, "and not atop of Shooter\'s yet! Tst! Yah! Get on with you!"' },
    { type: 'p',  text: 'The emphatic horse, cut short by the whip in a most decided negative, made a decided scramble for it, and the three other horses followed suit. Once more, the Dover mail struggled on, with the jack-boots of its passengers squashing along by its side. They had stopped when the coach stopped, and they kept close company with it. If any one of the three had had the hardihood to propose to another to walk on a little ahead into the mist and darkness, he would have put himself in a fair way of getting shot instantly as a highwayman. The last burst carried the mail to the summit of the hill. The horses stopped to breathe again, and the guard got down to skid the wheel for the descent, and open the coach-door to let the passengers in.' },
    { type: 'p',  text: '"Tst! Joe!" cried the coachman in a warning voice, looking down from his box. "What do you say, Tom?" They both listened. "I say a horse at a canter coming up, Joe." "I say a horse at a gallop, Tom," returned the guard, leaving his hold of the door, and mounting nimbly to his place. "Gentlemen! In the king\'s name, all of you!" With this hurried adjuration, he cocked his blunderbuss, and stood on the offensive.' },
    { type: 'p',  text: 'The passenger booked by this history, was on the coach-step, getting in; the two other passengers were close behind him, and about to follow. He remained on the step, half in the coach and half out of; they remained in the road below him. They all looked from the coachman to the guard, and from the guard to the coachman, and listened. The coachman looked back and the guard looked back, and even the emphatic leader pricked up his ears and looked back, without contradicting.' },
    { type: 'p',  text: 'The stillness consequent on the cessation of the rumbling and labouring of the coach, added to the stillness of the night, made it very quiet indeed. The panting of the horses communicated a tremulous motion to the coach, as if it were in a state of agitation. The hearts of the passengers beat loud enough perhaps to be heard; but at any rate, the quiet pause was audibly expressive of people out of breath, and holding the breath, and having the pulses quickened by expectation.' },
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
  eventTitle: { size: 28, tracking: -0.015, leading: 1.1, axisOverrides: { wght: 600 } },
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
  pageTitle: { size: 20, tracking: -0.01,  leading: 1.2, axisOverrides: { wght: 700 } },
  cardTitle: { size: 14, tracking: 0,      leading: 1.3, axisOverrides: { wght: 500 } },
  cardSlug:  { size: 12, tracking: 0,      leading: 1.4, axisOverrides: {} },
  cardDesc:  { size: 13, tracking: 0,      leading: 1.5, axisOverrides: {} },
  badge:     { size: 11, tracking: 0,      leading: 1,   axisOverrides: {} },
}

// ── Paragraph style model ────────────────────────────────────────────────────
const DEFAULT_PARA_STYLES = {
  h1: { size: 57, leading: 1.1, tracking: 0,     axisOverrides: { wght: 700 } },
  h2: { size: 32, leading: 1.2, tracking: 0,     axisOverrides: { wght: 400 } },
  h3: { size: 22, leading: 1.3, tracking: 0,     axisOverrides: {} },
  p:  { size: 18, leading: 1.6, tracking: 0,     axisOverrides: {} },
}

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

const GLYPH_SETS = {
  'Uppercase': 'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
  'Lowercase': 'abcdefghijklmnopqrstuvwxyz',
  'Numerals': '0123456789',
  'Punctuation': '.,;:!?\'"-()[]{}/@#$%^&*+=<>\\|`~',
  'Accents': 'ÀÁÂÃÄÅÆÇÈÉÊËÌÍÎÏÐÑÒÓÔÕÖØÙÚÛÜÝÞßàáâãäåæçèéêëìíîïðñòóôõöøùúûüýþÿ',
}

// ── Slider row component ─────────────────────────────────────────────────────
function SliderRow({ label, tag, value, min, max, step, onChange, display, lockedAbove }) {
  const lockedPct = lockedAbove != null
    ? Math.max(0, Math.min(100, (lockedAbove - min) / (max - min) * 100))
    : null
  return (
    <div className="slider-row">
      <div className="slider-label">
        <span className="slider-label-left">
          <span className={`slider-label-text${tag ? ' slider-label-text--tagged' : ''}`}>{label}</span>
          {tag && <span className="slider-tag">{tag}</span>}
        </span>
        <input
          className="slider-number"
          type="text"
          inputMode="numeric"
          value={display != null ? String(display).replace('-', '−') : value}
          onChange={e => onChange(parseFloat(String(e.target.value).replace('−', '-')))}
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
          value={value}
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

  // Font loading
  const [fontName, setFontName] = useState(null)
  const [fontFace, setFontFace] = useState(null)
  const [italicFontFace, setItalicFontFace] = useState(null)
  const [isItalic, setIsItalic] = useState(false)
  const [variationAxes, setVariationAxes] = useState([]) // [{tag, name, min, max, defaultVal}]
  const [axisValues, setAxisValues] = useState({})
  const [namedInstances, setNamedInstances] = useState([]) // [{name, coordinates: {tag: value}}]
  const [isDragging, setIsDragging] = useState(false)
  const fontObjectUrl = useRef(null)

  // View mode
  const [mode, setMode] = useState(isCalcom ? 'calcom' : 'big') // 'big' | 'paragraph' | 'glyphs' | 'calcom'

  // Cal.com preview state
  const [calcomFont, setCalcomFont] = useState('calsansui')
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

  // Typography controls
  const [fontSize, setFontSize] = useState(200)
  const [letterSpacing, setLetterSpacing] = useState(0)
  const [lineHeight, setLineHeight] = useState(1.1)

  // Alignment
  const [textAlign, setTextAlign] = useState('left')

  // Glyph set selection
  const [activeGlyphSet, setActiveGlyphSet] = useState('Uppercase')

  const fileInputRef = useRef(null)
  const previewAreaRef = useRef(null)
  const bigEditorRef = useRef(null)
  const blockRefs = useRef({})
  const stylesPanelBtnRef = useRef(null)
  const mobileStylesBtnRef = useRef(null)
  const stylesPanelPopoverRef = useRef(null)
  const calcomPanelBtnRef = useRef(null)
  const calcomPanelPopoverRef = useRef(null)
  const cossPanelBtnRef = useRef(null)
  const cossPanelPopoverRef = useRef(null)

  const bigEditorCallback = useCallback(el => {
    bigEditorRef.current = el
    if (el && !el.textContent) el.textContent = SAMPLE_BIG
  }, [])

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

  // ── Auto-load font from URL route ──────────────────────────────────────────
  useEffect(() => {
    if (!fontSlug) return

    const special = matchSpecial(fontSlug)
    const resolvedSlug = special ? 'calsansui' : fontSlug
    const matched = matchFont(resolvedSlug)
    if (!matched) return

    const loadRouteFont = async () => {
      const baseName = special ? special.name : matched.filename.replace(/\.[^/.]+$/, '').replace(/\s*[\[(].*$/g, '').trim()
      const name = `${baseName} Preview`

      // Load roman face
      const face = new FontFace(name, `url(${matched.url})`)
      const loaded = await face.load()
      document.fonts.add(loaded)
      setFontFace(loaded)
      setFontName(matched.filename.replace(/\.[^/.]+$/, ''))
      autoFitSize(name)

      // Load italic companion (registers under same family with style:'italic')
      const italicMatch = matchItalicFont(resolvedSlug)
      if (italicMatch) {
        const italicFace = new FontFace(name, `url(${italicMatch.url})`, { style: 'italic' })
        const loadedItalic = await italicFace.load()
        document.fonts.add(loadedItalic)
        setItalicFontFace(loadedItalic)
      } else {
        setItalicFontFace(null)
        setIsItalic(false)
      }

      // Axes + instances from virtual module (covers TTF and woff2)
      const { axes, instances } = fontAxesData[matched.filename] ?? { axes: [], instances: [] }
      setVariationAxes(axes)
      setNamedInstances(instances)
      const defaults = {}
      axes.forEach(a => { defaults[a.tag] = a.defaultVal })
      setAxisValues(defaults)
    }
    loadRouteFont().catch(console.error)
  }, [fontSlug])

  // ── Font loading ───────────────────────────────────────────────────────────
  const loadFont = useCallback(async (file) => {
    try {
      if (fontObjectUrl.current) {
        URL.revokeObjectURL(fontObjectUrl.current)
      }

      const url = URL.createObjectURL(file)
      fontObjectUrl.current = url

      const baseName = file.name.replace(/\.[^/.]+$/, '').replace(/\s*[\[(].*$/g, '').trim()
      const name = `${baseName} Preview`
      const face = new FontFace(name, `url(${url})`)
      const loaded = await face.load()
      document.fonts.add(loaded)
      setFontFace(loaded)
      setFontName(file.name.replace(/\.[^/.]+$/, ''))
      autoFitSize(name)

      // Try to read variable font axes via opentype.js style
      // We'll use a simple approach: check if font has variation settings
      // by using the font's internal data
      await detectAxes(file, name)
    } catch (err) {
      console.error('Font load error', err)
    }
  }, [])

  const detectAxes = async (file) => {
    // Try virtual module first (covers all font formats including woff2)
    const known = fontAxesData[file.name]
    if (known) {
      setVariationAxes(known.axes)
      setNamedInstances(known.instances)
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
      if (sig === 0x774F4646 || sig === 0x774F4632) { setVariationAxes([]); setNamedInstances([]); setAxisValues({}); return }
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
    setIsDragging(false)
    const file = e.dataTransfer.files[0]
    if (file) loadFont(file)
  }, [loadFont])

  const handleDragOver = (e) => { e.preventDefault(); setIsDragging(true) }
  const handleDragLeave = () => setIsDragging(false)

  useEffect(() => {
    window.addEventListener('dragover', handleDragOver)
    window.addEventListener('dragleave', handleDragLeave)
    window.addEventListener('drop', handleDrop)
    return () => {
      window.removeEventListener('dragover', handleDragOver)
      window.removeEventListener('dragleave', handleDragLeave)
      window.removeEventListener('drop', handleDrop)
    }
  }, [handleDrop])
  // ── Font variation string ─────────────────────────────────────────────────
  const fontVariationSettings = Object.entries(axisValues)
    .map(([tag, val]) => `"${tag}" ${val}`)
    .join(', ') || 'normal'

  const fontStyle = isItalic && italicFontFace ? 'italic' : 'normal'

  const previewStyle = {
    fontFamily: fontFace ? fontFace.family : 'serif',
    fontStyle,
    fontSize: `${fontSize}px`,
    letterSpacing: `${letterSpacing}em`,
    lineHeight: lineHeight,
    fontVariationSettings,
    fontSynthesis: 'none',
    fontFeatureSettings: '"calt" 0, "ss20" 0',
    textAlign,
    color: 'var(--text)',
    wordBreak: 'break-word',
    transition: 'font-variation-settings 0.15s ease',
  }

  // ── Active style for sidebar controls in paragraph mode ──────────────────
  const effectiveParaStyle = mode === 'paragraph' ? (activeParaStyle ?? 'p') : null

  // ── Active role for calcom mode ───────────────────────────────────────────
  const effectiveCalcomRole = mode === 'calcom' ? activeCalcomRole : null
  const effectiveCossRole = mode === 'coss' ? activeCossRole : null

  const roleStyle = (role) => {
    const r = calcomRoles[role] ?? calcomRoles.eventDesc
    const merged = { ...axisValues, ...r.axisOverrides }
    const fvs = Object.entries(merged).map(([t, v]) => `"${t}" ${v}`).join(', ') || 'normal'
    if (role === 'eventTitle') {
      return {
        fontFamily: "'Cal Sans', sans-serif",
        fontSize: `${r.size}px`,
        letterSpacing: `${r.tracking}em`,
        lineHeight: r.leading,
        fontVariationSettings: 'normal',
        fontSynthesis: 'none',
        fontFeatureSettings: 'normal',
      }
    }
    const family = calcomFont === 'calsansui'
      ? (fontFace ? fontFace.family : '"Inter", system-ui, sans-serif')
      : '"Inter", system-ui, -apple-system, sans-serif'
    return {
      fontFamily: family,
      fontSize: `${r.size}px`,
      letterSpacing: `${r.tracking}em`,
      lineHeight: r.leading,
      fontVariationSettings: calcomFont === 'calsansui' ? fvs : 'normal',
      fontSynthesis: 'none',
      fontFeatureSettings: '"calt" 0, "ss20" 0',
    }
  }

  const cossRoleStyle = (role) => {
    const r = cossRoles[role] ?? cossRoles.cardDesc
    const merged = { ...axisValues, ...r.axisOverrides }
    const fvs = Object.entries(merged).map(([t, v]) => `"${t}" ${v}`).join(', ') || 'normal'
    if (role === 'pageTitle') {
      return {
        fontFamily: "'Cal Sans', sans-serif",
        fontSize: `${r.size}px`,
        letterSpacing: `${r.tracking}em`,
        lineHeight: r.leading,
        fontVariationSettings: 'normal',
        fontSynthesis: 'none',
        fontFeatureSettings: 'normal',
      }
    }
    const family = calcomFont === 'calsansui'
      ? (fontFace ? fontFace.family : '"Inter", system-ui, sans-serif')
      : '"Inter", system-ui, -apple-system, sans-serif'
    return {
      fontFamily: family,
      fontSize: `${r.size}px`,
      letterSpacing: `${r.tracking}em`,
      lineHeight: r.leading,
      fontVariationSettings: calcomFont === 'calsansui' ? fvs : 'normal',
      fontSynthesis: 'none',
      fontFeatureSettings: '"calt" 0, "ss20" 0',
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

  // ── Per-block style (paragraph mode) ─────────────────────────────────────
  const blockStyle = (type) => {
    const s = paraStyles[type] ?? paraStyles.p
    const merged = { ...axisValues, ...s.axisOverrides }
    const fvs = Object.entries(merged).map(([t, v]) => `"${t}" ${v}`).join(', ') || 'normal'
    return {
      fontFamily: fontFace ? fontFace.family : 'serif',
      fontStyle,
      fontSize: `${s.size}px`,
      letterSpacing: `${s.tracking}em`,
      lineHeight: s.leading,
      fontVariationSettings: fvs,
      fontSynthesis: 'none',
      fontFeatureSettings: '"calt" 0, "ss20" 0',
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
        <button className={`mobile-tab ${mode === 'big' ? 'active' : ''}`} onClick={() => setMode('big')}><BigIcon /> Big Word</button>
        <button className={`mobile-tab ${mode === 'paragraph' ? 'active' : ''}`} onClick={() => setMode('paragraph')}><ParaIcon /> Paragraph</button>
        <button className={`mobile-tab ${mode === 'glyphs' ? 'active' : ''}`} onClick={() => setMode('glyphs')}><GlyphIcon /> Glyphs</button>
      </nav>

      {/* Mobile sub-bar: context-sensitive chips */}
      {fontName && (mode === 'glyphs' || mode === 'paragraph') && (
        <div className="mobile-sub-bar">
          {mode === 'glyphs' && Object.keys(GLYPH_SETS).map(k => (
            <button
              key={k}
              className={`mobile-sub-btn ${activeGlyphSet === k ? 'active' : ''}`}
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
        </div>
      )}

      {/* Sidebar */}
      <aside className="sidebar">
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
              <BigIcon /> Big Word
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
            <ModeBtn active={mode === 'glyphs'} onClick={() => setMode('glyphs')}>
              <GlyphIcon /> Glyphs
            </ModeBtn>
          </div>
        </div>

        <div className="sidebar-divider" />

        {/* Cal.com font radio */}
        {mode === 'calcom' && (
          <>
            <div className="sidebar-divider" />
            <div className="sidebar-section">
              <div className="section-label">Font</div>
              <label className="calcom-radio-label">
                <input type="radio" name="calcom-font" value="calsansui" checked={calcomFont === 'calsansui'} onChange={() => setCalcomFont('calsansui')} />
                Cal Sans UI 1.727
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
          </div>
          {italicFontFace && (
            <div className="roman-italic-toggle">
              <button
                className={`roman-italic-btn${!isItalic ? ' active' : ''}`}
                onClick={() => setIsItalic(false)}
              >Roman</button>
              <button
                className={`roman-italic-btn${isItalic ? ' active' : ''}`}
                onClick={() => setIsItalic(true)}
              >Italic</button>
            </div>
          )}
          {namedInstances.length > 0 && (() => {
            const currentCoords = effectiveParaStyle
              ? { ...axisValues, ...paraStyles[effectiveParaStyle].axisOverrides }
              : axisValues
            const activeInst = namedInstances.find(inst =>
              variationAxes.every(a => (currentCoords[a.tag] ?? a.defaultVal) === inst.coordinates[a.tag])
            )
            const applyInstance = (name) => {
              const inst = namedInstances.find(i => i.name === name)
              if (!inst) return
              if (effectiveParaStyle) {
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
                  const axesDirty = effectiveParaStyle
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
                        if (effectiveParaStyle) {
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
                const val = effectiveParaStyle
                  ? (paraStyles[effectiveParaStyle].axisOverrides[axis.tag] ?? axisValues[axis.tag] ?? axis.defaultVal)
                  : effectiveCalcomRole
                  ? (calcomRoles[effectiveCalcomRole].axisOverrides[axis.tag] ?? axisValues[axis.tag] ?? axis.defaultVal)
                  : effectiveCossRole
                  ? (cossRoles[effectiveCossRole].axisOverrides[axis.tag] ?? axisValues[axis.tag] ?? axis.defaultVal)
                  : (axisValues[axis.tag] ?? axis.defaultVal)
                return (
                  <SliderRow
                    key={axis.tag}
                    label={axis.name}
                    tag={axis.tag}
                    value={val}
                    min={axis.min}
                    max={axis.max}
                    step={(axis.max - axis.min) > 10 ? 1 : 0.01}
                    onChange={v => {
                      if (effectiveParaStyle) {
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
                      } else {
                        setAxisValues(prev => ({ ...prev, [axis.tag]: v }))
                      }
                    }}
                    display={Math.round(val)}
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
                {Object.keys(GLYPH_SETS).map(k => (
                  <button
                    key={k}
                    className={`glyph-set-btn ${activeGlyphSet === k ? 'active' : ''}`}
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
              {blocks.map(block => (
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
                  onInput={e => handleBlockInput(block.id, e)}
                  onKeyDown={e => handleBlockKeyDown(block.id, e)}
                />
              ))}
          </div>
        )}

        {fontName && mode === 'glyphs' && (
          <div className="preview-glyphs">
            <div className="glyphs-grid" style={{
              fontFamily: previewStyle.fontFamily,
              fontVariationSettings,
              fontSize: `${Math.min(fontSize, 120)}px`,
              lineHeight: 1,
              transition: 'font-variation-settings 0.15s ease',
            }}>
              {[...GLYPH_SETS[activeGlyphSet]].map((char, i) => (
                <div key={i} className="glyph-cell">
                  <div className="glyph-char">{char}</div>
                  <div className="glyph-code">U+{char.charCodeAt(0).toString(16).toUpperCase().padStart(4, '0')}</div>
                </div>
              ))}
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
            {Object.entries(CALCOM_ROLE_LABELS).map(([key, label]) => {
              const r = calcomRoles[key]
              const merged = { ...axisValues, ...r.axisOverrides }
              const fvs = Object.entries(merged).map(([t, v]) => `"${t}" ${v}`).join(', ') || 'normal'
              const family = calcomFont === 'inter'
                ? '"Inter", system-ui, sans-serif'
                : fontFace ? fontFace.family : 'serif'
              const isActive = activeCalcomRole === key
              return (
                <button
                  key={key}
                  className={`para-styles-row ${isActive ? 'active' : ''}`}
                  onClick={() => { setActiveCalcomRole(prev => prev === key ? null : key); setCalcomPanelOpen(false) }}
                >
                  <span
                    className="para-styles-preview"
                    style={{
                      fontFamily: family,
                      fontSize: `${Math.min(r.size, 22)}px`,
                      fontVariationSettings: calcomFont === 'calsansui' ? fvs : 'normal',
                      fontSynthesis: 'none',
                      lineHeight: 1.3,
                    }}
                  >
                    {label}
                  </span>
                  <span className="para-styles-specs">
                    <span className="para-styles-spec">{r.size}px</span>
                    <span className="para-styles-spec">{r.tracking.toFixed(3)}</span>
                    {variationAxes.map(axis => {
                      const val = r.axisOverrides[axis.tag] ?? axisValues[axis.tag] ?? axis.defaultVal
                      const isLocal = axis.tag in r.axisOverrides
                      return (
                        <span key={axis.tag} className={`para-styles-spec${isLocal ? ' para-styles-spec--local' : ''}`}>
                          {axis.tag} {Number.isInteger(val) ? val : val.toFixed(1)}
                        </span>
                      )
                    })}
                  </span>
                </button>
              )
            })}
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
            {Object.entries(COSS_ROLE_LABELS).map(([key, label]) => {
              const r = cossRoles[key]
              const merged = { ...axisValues, ...r.axisOverrides }
              const fvs = Object.entries(merged).map(([t, v]) => `"${t}" ${v}`).join(', ') || 'normal'
              const family = calcomFont === 'inter'
                ? '"Inter", system-ui, sans-serif'
                : fontFace ? fontFace.family : 'serif'
              const isActive = activeCossRole === key
              return (
                <button
                  key={key}
                  className={`para-styles-row ${isActive ? 'active' : ''}`}
                  onClick={() => { setActiveCossRole(prev => prev === key ? null : key); setCossPanelOpen(false) }}
                >
                  <span
                    className="para-styles-preview"
                    style={{
                      fontFamily: family,
                      fontSize: `${Math.min(r.size, 22)}px`,
                      fontVariationSettings: calcomFont === 'calsansui' ? fvs : 'normal',
                      fontSynthesis: 'none',
                      lineHeight: 1.3,
                    }}
                  >
                    {label}
                  </span>
                  <span className="para-styles-specs">
                    <span className="para-styles-spec">{r.size}px</span>
                    <span className="para-styles-spec">{r.tracking.toFixed(3)}</span>
                    {variationAxes.map(axis => {
                      const val = r.axisOverrides[axis.tag] ?? axisValues[axis.tag] ?? axis.defaultVal
                      const isLocal = axis.tag in r.axisOverrides
                      return (
                        <span key={axis.tag} className={`para-styles-spec${isLocal ? ' para-styles-spec--local' : ''}`}>
                          {axis.tag} {Number.isInteger(val) ? val : val.toFixed(1)}
                        </span>
                      )
                    })}
                  </span>
                </button>
              )
            })}
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
            {(['h1', 'h2', 'h3', 'p']).map(type => {
              const s = paraStyles[type]
              const isActive = activeParaStyle === type
              const merged = { ...axisValues, ...s.axisOverrides }
              const fvs = Object.entries(merged).map(([t, v]) => `"${t}" ${v}`).join(', ') || 'normal'
              const label = type === 'p' ? 'Paragraph' : `Heading ${type[1]}`
              return (
                <button
                  key={type}
                  className={`para-styles-row ${isActive ? 'active' : ''}`}
                  onClick={() => setActiveParaStyle(prev => prev === type ? null : type)}
                >
                  <span
                    className="para-styles-preview"
                    style={{
                      fontFamily: fontFace ? fontFace.family : 'serif',
                      fontStyle,
                      fontSize: `${Math.min(s.size, 22)}px`,
                      fontVariationSettings: fvs,
                      fontSynthesis: 'none',
                      lineHeight: 1.3,
                    }}
                  >
                    {label}
                  </span>
                  <span className="para-styles-specs">
                    <span className="para-styles-spec">{s.size}px</span>
                    {Object.entries(s.axisOverrides).map(([tag, val]) => (
                      <span key={tag} className="para-styles-spec">
                        {tag} {Number.isInteger(val) ? val : val.toFixed(1)}
                      </span>
                    ))}
                  </span>
                </button>
              )
            })}
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
            <div key={et.id} className="coss-event-card">
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
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="coss-badge-icon"><path d="M12 2a10 10 0 0 1 7.38 16.75"/><path d="M12 6v6l4 2"/><path d="M2.5 8.875a10 10 0 0 0-.5 3"/><path d="M2.83 16a10 10 0 0 0 2.43 3.4"/><path d="M4.636 5.235a10 10 0 0 1 .891-.857"/><path d="M8.644 21.42a10 10 0 0 0 7.631-.38"/></svg>
                    {et.duration}
                  </span>
                  {et.badges.includes('confirmation') && (
                    <span className={`coss-badge coss-badge--confirm ${roleClass('badge')}`} style={roleStyle('badge')}
                      onClick={() => onRoleClick(r => r === 'badge' ? null : 'badge')}>
                      Requires confirmation
                    </span>
                  )}
                  {et.badges.includes('hidden') && (
                    <span className={`coss-badge coss-badge--hidden ${roleClass('badge')}`} style={roleStyle('badge')}
                      onClick={() => onRoleClick(r => r === 'badge' ? null : 'badge')}>
                      Hidden
                    </span>
                  )}
                  {et.badges.includes('paid') && (
                    <span className={`coss-badge coss-badge--paid ${roleClass('badge')}`} style={roleStyle('badge')}
                      onClick={() => onRoleClick(r => r === 'badge' ? null : 'badge')}>
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
function BigIcon() {
  return <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><text x="1" y="12" fontSize="13" fill="currentColor" fontFamily="'CalSansUI', system-ui, sans-serif">A</text></svg>
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
