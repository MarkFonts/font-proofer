import { useState, useRef, useEffect, useCallback } from 'react'
import './App.css'
import logoGif from '/public/logo.gif'

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
const CALSANSUI_AXES = [
  { tag: 'opsz', name: 'Optical Size',min: 10,  max: 10.1, defaultVal: 10  },
  { tag: 'wght', name: 'Weight',      min: 400, max: 600,  defaultVal: 400 },
  { tag: 'GEOM', name: 'Geometric Formality', min: 0, max: 100, defaultVal: 0 },
  { tag: 'YTAS', name: 'Y Ascender',  min: 720, max: 800,  defaultVal: 720 },
  { tag: 'SHRP', name: 'Sharpness',   min: 0,   max: 100,  defaultVal: 0   },
]

const SPECIAL_FONTS = {
  calsansui: { family: 'CalSansUI', name: 'CalSansUI', axes: CALSANSUI_AXES },
  calsans:   { family: 'CalSansUI', name: 'Cal Sans (UI)', axes: CALSANSUI_AXES },
}

function matchSpecial(slug) {
  return SPECIAL_FONTS[slug.toLowerCase().replace(/[-_\s]/g, '')] || null
}

function matchFont(slug) {
  const needle = normalize(slug)
  const entries = Object.entries(fontModules)
  if (!entries.length) return null
  const match = entries.find(([path]) => {
    const name = normalize(path.split('/').pop().replace(/\.[^.]+$/, ''))
    return name.includes(needle) || needle.includes(name)
  })
  return match ? { url: match[1], filename: match[0].split('/').pop() } : null
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

    // Special built-in fonts — resolve to a real file via matchFont
    const special = matchSpecial(fontSlug)
    const resolvedSlug = special ? 'calsansui' : fontSlug

    const matched = matchFont(resolvedSlug)
    if (!matched) return
    const loadRouteFont = async () => {
      const baseName = special ? special.name : matched.filename.replace(/\.[^/.]+$/, '').replace(/\s*[\[(].*$/g, '').trim()
      const name = `${baseName} Preview`
      const face = new FontFace(name, `url(${matched.url})`)
      const loaded = await face.load()
      document.fonts.add(loaded)
      setFontFace(loaded)
      setFontName(matched.filename.replace(/\.[^/.]+$/, ''))
      autoFitSize(name)
      if (special) {
        setVariationAxes(special.axes)
        setNamedInstances([])
        const defaults = {}
        special.axes.forEach(a => { defaults[a.tag] = a.defaultVal })
        setAxisValues(defaults)
      } else {
        const res = await fetch(matched.url)
        const buffer = await res.arrayBuffer()
        const { axes, instances } = parseVariationAxes(buffer)
        setVariationAxes(axes)
        setNamedInstances(instances)
        const defaults = {}
        axes.forEach(a => { defaults[a.tag] = a.defaultVal })
        setAxisValues(defaults)
      }
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
    try {
      const buffer = await file.arrayBuffer()
      const { axes, instances } = parseVariationAxes(buffer)
      if (axes.length > 0) {
        setVariationAxes(axes)
        setNamedInstances(instances)
        const defaults = {}
        axes.forEach(a => { defaults[a.tag] = a.defaultVal })
        setAxisValues(defaults)
        return
      }
      // woff/woff2 compressed — try to match filename against special fonts
      const normalized = file.name.replace(/\.[^.]+$/, '').toLowerCase().replace(/[-_\s]/g, '')
      const specialEntry = Object.entries(SPECIAL_FONTS).find(([key]) => normalized.includes(key))
      if (specialEntry) {
        const special = specialEntry[1]
        setVariationAxes(special.axes)
        setNamedInstances([])
        const defaults = {}
        special.axes.forEach(a => { defaults[a.tag] = a.defaultVal })
        setAxisValues(defaults)
      } else {
        setVariationAxes([])
        setNamedInstances([])
        setAxisValues({})
      }
    } catch (e) {
      setVariationAxes([])
      setNamedInstances([])
      setAxisValues({})
    }
  }

  // Minimal fvar + name table parser (TTF/OTF only — WOFF/WOFF2 are compressed)
  const parseVariationAxes = (buffer) => {
    const empty = { axes: [], instances: [] }
    try {
      const data = new DataView(buffer)
      const sig = data.getUint32(0)
      // wOFF = 0x774F4646, wOF2 = 0x774F4632
      if (sig === 0x774F4646 || sig === 0x774F4632) return empty
      const numTables = data.getUint16(4)
      let fvarOffset = 0
      let nameOffset = 0

      for (let i = 0; i < numTables; i++) {
        const t = String.fromCharCode(
          data.getUint8(12 + i * 16),
          data.getUint8(13 + i * 16),
          data.getUint8(14 + i * 16),
          data.getUint8(15 + i * 16),
        )
        if (t === 'fvar') fvarOffset = data.getUint32(12 + i * 16 + 8)
        if (t === 'name') nameOffset = data.getUint32(12 + i * 16 + 8)
      }

      if (!fvarOffset) return empty

      // Read a nameID string from the name table (prefers Windows Unicode)
      const getNameString = (nameID) => {
        if (!nameOffset) return null
        const count = data.getUint16(nameOffset + 2)
        const stringBase = nameOffset + data.getUint16(nameOffset + 4)
        let win = null, mac = null
        for (let i = 0; i < count; i++) {
          const r = nameOffset + 6 + i * 12
          const platformID = data.getUint16(r)
          const encodingID = data.getUint16(r + 2)
          const nID = data.getUint16(r + 6)
          const len = data.getUint16(r + 8)
          const strOff = data.getUint16(r + 10)
          if (nID !== nameID) continue
          if (platformID === 3 && encodingID === 1) {
            const chars = []
            for (let j = 0; j < len; j += 2) chars.push(String.fromCharCode(data.getUint16(stringBase + strOff + j)))
            win = chars.join('')
          } else if (platformID === 1 && !mac) {
            const chars = []
            for (let j = 0; j < len; j++) chars.push(String.fromCharCode(data.getUint8(stringBase + strOff + j)))
            mac = chars.join('')
          }
        }
        return win || mac
      }

      const axisArrayOffset = data.getUint16(fvarOffset + 4)
      const axisCount = data.getUint16(fvarOffset + 8)
      const axisSize = data.getUint16(fvarOffset + 10)
      const instanceCount = data.getUint16(fvarOffset + 12)
      const instanceSize = data.getUint16(fvarOffset + 14)

      const tagLabels = {
        wght: 'Weight', wdth: 'Width', ital: 'Italic', slnt: 'Slant',
        opsz: 'Optical Size', GRAD: 'Grade', XHGT: 'X-Height',
        YOPQ: 'Y Opacity', YTUC: 'Uppercase Height', YTLC: 'Lowercase Height',
      }

      const axes = []
      const tags = []
      for (let i = 0; i < axisCount; i++) {
        const off = fvarOffset + axisArrayOffset + i * axisSize
        const tag = String.fromCharCode(
          data.getUint8(off), data.getUint8(off + 1),
          data.getUint8(off + 2), data.getUint8(off + 3),
        )
        const minVal = data.getInt32(off + 4) / 65536
        const defaultVal = data.getInt32(off + 8) / 65536
        const maxVal = data.getInt32(off + 12) / 65536
        const axisNameID = data.getUint16(off + 18)
        const fontName = getNameString(axisNameID)
        const name = fontName || tagLabels[tag] || tag

        tags.push(tag)
        axes.push({ tag, name, min: minVal, max: maxVal, defaultVal })
      }

      const instancesStart = fvarOffset + axisArrayOffset + axisCount * axisSize
      const instances = []
      for (let i = 0; i < instanceCount; i++) {
        const off = instancesStart + i * instanceSize
        const nameID = data.getUint16(off)
        const name = getNameString(nameID)
        if (!name) continue
        const coordinates = {}
        for (let j = 0; j < axisCount; j++) {
          coordinates[tags[j]] = data.getInt32(off + 4 + j * 4) / 65536
        }
        instances.push({ name, coordinates })
      }

      return { axes, instances }
    } catch {
      return empty
    }
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

  const previewStyle = {
    fontFamily: fontFace ? `"${fontFace.family}"` : 'serif',
    fontSize: `${fontSize}px`,
    letterSpacing: `${letterSpacing}em`,
    lineHeight: lineHeight,
    fontVariationSettings,
    fontSynthesis: 'none',
    fontFeatureSettings: '"calt" 0, "ss20" 0',
    textAlign,
    color: '#ffffff',
    wordBreak: 'break-word',
    transition: 'font-variation-settings 0.15s ease',
  }

  // ── Active style for sidebar controls in paragraph mode ──────────────────
  const effectiveParaStyle = mode === 'paragraph' ? (activeParaStyle ?? 'p') : null

  // ── Active role for calcom mode ───────────────────────────────────────────
  const effectiveCalcomRole = mode === 'calcom' ? activeCalcomRole : null

  const roleStyle = (role) => {
    const r = calcomRoles[role] ?? calcomRoles.eventDesc
    const merged = { ...axisValues, ...r.axisOverrides }
    const fvs = Object.entries(merged).map(([t, v]) => `"${t}" ${v}`).join(', ') || 'normal'
    const family = calcomFont === 'inter'
      ? '"Inter", system-ui, -apple-system, sans-serif'
      : fontFace ? `"${fontFace.family}"` : '"Inter", system-ui, sans-serif'
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
      fontFamily: fontFace ? `"${fontFace.family}"` : 'serif',
      fontSize: `${s.size}px`,
      letterSpacing: `${s.tracking}em`,
      lineHeight: s.leading,
      fontVariationSettings: fvs,
      fontSynthesis: 'none',
      fontFeatureSettings: '"calt" 0, "ss20" 0',
      textAlign,
      color: '#ffffff',
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

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div
      className={`layout ${isDragging ? 'dragging' : ''}`}
    >
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
        {isCalcom && <button className={`mobile-tab ${mode === 'calcom' ? 'active' : ''}`} onClick={() => setMode('calcom')}><CalIcon /> Cal.com</button>}
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
          <img src={logoGif} alt="Logo" className="logo-gif" />
          {clientLabel && clientSlug !== 'wordmark' && <span className="client-label">{clientLabel}</span>}
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
                  <CalIcon /> Cal.com
                </ModeBtn>
                {fontName && (
                  <button
                    ref={calcomPanelBtnRef}
                    className={`align-btn styles-toggle-btn ${calcomPanelOpen ? 'active' : ''}`}
                    title="Type roles panel"
                    onClick={() => setCalcomPanelOpen(p => !p)}
                  >
                    {calcomPanelOpen ? '▶' : '▷'}
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
              {fontName && (
                <button
                  ref={stylesPanelBtnRef}
                  className={`align-btn styles-toggle-btn ${paraStylesPanelOpen ? 'active' : ''}`}
                  title="Styles panel"
                  onClick={() => setParaStylesPanelOpen(p => !p)}
                >
                  {paraStylesPanelOpen ? '▶' : '▷'}
                </button>
              )}
            </div>
            <ModeBtn active={mode === 'glyphs'} onClick={() => setMode('glyphs')}>
              <GlyphIcon /> Glyphs
            </ModeBtn>
          </div>
        </div>

        <div className="sidebar-divider" />

        {/* Cal.com font radio + type roles */}
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
                Inter
              </label>
            </div>
            <div className="sidebar-divider" />
            <div className="sidebar-section">
              <div className="typography-header">
                <div className="section-label">
                  Type Roles
                  {activeCalcomRole && (
                    <span className="section-label-sub">{CALCOM_ROLE_LABELS[activeCalcomRole]}</span>
                  )}
                </div>
                {activeCalcomRole && (() => {
                  const r = calcomRoles[activeCalcomRole]
                  const def = DEFAULT_CALCOM_ROLES[activeCalcomRole]
                  const dirty = r.size !== def.size || r.tracking !== def.tracking
                  return (
                    <button
                      className={`align-btn ${dirty ? 'active' : 'reset-clean'}`}
                      title="Reset role"
                      style={dirty ? {} : { pointerEvents: 'none' }}
                      onClick={() => setCalcomRoles(prev => ({
                        ...prev,
                        [activeCalcomRole]: { ...prev[activeCalcomRole], size: def.size, tracking: def.tracking }
                      }))}
                    ><ResetIcon /></button>
                  )
                })()}
              </div>
              <div className="calcom-role-chips">
                {Object.entries(CALCOM_ROLE_LABELS).map(([key, label]) => (
                  <button
                    key={key}
                    className={`calcom-role-chip ${activeCalcomRole === key ? 'active' : ''}`}
                    onClick={() => setActiveCalcomRole(prev => prev === key ? null : key)}
                  >
                    {label}
                  </button>
                ))}
              </div>
              {activeCalcomRole && (
                <>
                  <SliderRow
                    label="Size"
                    value={calcomRoles[activeCalcomRole].size}
                    min={8} max={80} step={1}
                    onChange={v => setCalcomRoles(prev => ({ ...prev, [activeCalcomRole]: { ...prev[activeCalcomRole], size: v } }))}
                  />
                  <SliderRow
                    label="Tracking"
                    value={calcomRoles[activeCalcomRole].tracking}
                    min={-0.2} max={0.5} step={0.001}
                    display={calcomRoles[activeCalcomRole].tracking.toFixed(3)}
                    onChange={v => setCalcomRoles(prev => ({ ...prev, [activeCalcomRole]: { ...prev[activeCalcomRole], tracking: v } }))}
                  />
                </>
              )}
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
                <div className="section-label">Variable Axes</div>
                {(() => {
                  const axesDirty = effectiveParaStyle
                    ? JSON.stringify(paraStyles[effectiveParaStyle].axisOverrides) !== JSON.stringify(DEFAULT_PARA_STYLES[effectiveParaStyle].axisOverrides)
                    : effectiveCalcomRole
                    ? JSON.stringify(calcomRoles[effectiveCalcomRole].axisOverrides) !== JSON.stringify(DEFAULT_CALCOM_ROLES[effectiveCalcomRole].axisOverrides)
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

        {fontName && mode === 'calcom' && (
          <CalcomPreview roleStyle={roleStyle} activeRole={activeCalcomRole} onRoleClick={setActiveCalcomRole} />
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
      {calcomPanelOpen && mode === 'calcom' && fontName && (() => {
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
                : fontFace ? `"${fontFace.family}"` : 'serif'
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
                      fontFamily: fontFace ? `"${fontFace.family}"` : 'serif',
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
                    {variationAxes.map(axis => {
                      const val = s.axisOverrides[axis.tag] ?? axisValues[axis.tag] ?? axis.defaultVal
                      return (
                        <span key={axis.tag} className="para-styles-spec">
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

  const times = ['4:15am','4:20am','4:25am','4:30am','6:00am','6:05am','6:15am','6:30am','6:45am','7:00am','11:30am','1:15pm','1:30pm','1:45pm']

  const roleClass = (role) => activeRole === role ? 'calcom-role-highlight' : ''

  return (
    <div className="calcom-page">
      <div className="calcom-card">
        {/* Left panel */}
        <div className="calcom-left">
          <div className="calcom-avatar">PR</div>
          <div className={`calcom-event-host ${roleClass('eventHost')}`} style={roleStyle('eventHost')}
            onClick={() => onRoleClick(r => r === 'eventHost' ? null : 'eventHost')}>
            Peer Richelsen
          </div>
          <div className={`calcom-event-title ${roleClass('eventTitle')}`} style={roleStyle('eventTitle')}
            onClick={() => onRoleClick(r => r === 'eventTitle' ? null : 'eventTitle')}>
            Meeting
          </div>
          <div className={`calcom-event-desc ${roleClass('eventDesc')}`} style={roleStyle('eventDesc')}
            onClick={() => onRoleClick(r => r === 'eventDesc' ? null : 'eventDesc')}>
            A quick screen share demo or longer conversation. Requires confirmation
          </div>
          <div className="calcom-durations">
            {[15, 30].map(d => (
              <button
                key={d}
                className={`calcom-dur-btn ${selectedDur === d ? 'active' : ''} ${roleClass('eventMeta')}`}
                style={roleStyle('eventMeta')}
                onClick={() => setSelectedDur(d)}
              >{d}m</button>
            ))}
          </div>
          <div className={`calcom-meta-item ${roleClass('eventMeta')}`} style={roleStyle('eventMeta')}
            onClick={() => onRoleClick(r => r === 'eventMeta' ? null : 'eventMeta')}>
            <span className="calcom-meta-icon">▷</span> Cal Video
          </div>
          <div className={`calcom-meta-item ${roleClass('eventMeta')}`} style={roleStyle('eventMeta')}>
            <span className="calcom-meta-icon">◎</span> America/New York
          </div>
        </div>

        {/* Calendar panel */}
        <div className="calcom-right">
          <div className="calcom-calendar-wrap">
            <div className="calcom-month-nav">
              <button className="calcom-nav-btn">‹</button>
              <span style={roleStyle('calHeader')}>April 2026</span>
              <button className="calcom-nav-btn">›</button>
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
              <div className="calcom-time-date" style={roleStyle('calHeader')}>
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
