// Original fictional learning tasks. Each topic has four different learning goals,
// not numbered copies of one request. No source text or local user content is used.
export const topicBanks = {
  Math: `
derivative rules|choose between the chain rule and product rule|find a missing inner derivative|differentiate a product of composite functions|explain derivative rules with an expression tree
quadratic equations|choose a method for solving a quadratic|check an extraneous quadratic root|model a rectangle with a quadratic equation|connect a parabola's roots to its graph
linear systems|set up two equations from a word problem|spot a sign error during elimination|compare two pricing plans with a linear system|explain what parallel lines mean for a system
fractions and rational expressions|find a common denominator with variables|identify an invalid cancellation across a sum|simplify a rational expression with excluded values|explain why division by zero changes the domain
trigonometry|choose sine or cosine from a triangle diagram|check whether a calculator is using degrees|estimate a height with an angle of elevation|connect the unit circle to triangle ratios
exponential functions|distinguish exponential growth from linear growth|find an incorrect percentage multiplier|model repeated depreciation of a bicycle|explain the meaning of an exponential starting value
logarithms|rewrite an exponential equation using logarithms|check a mistaken logarithm of a sum|compare doubling times for two growth models|explain why logarithms undo exponentiation
probability|count outcomes without double counting|spot a false assumption of independent events|build a tree diagram for sampling without replacement|explain why conditional probability changes the sample space
statistics|choose between the mean and median|find the effect of an outlier on a summary|compare two distributions with different spreads|explain why a larger sample does not remove selection bias
geometry proofs|choose a useful first statement in a triangle proof|find an unsupported step in a congruence argument|prove a relationship using parallel lines|explain the difference between a diagram and a proof
sequences|write a rule for an arithmetic sequence|identify a mistaken common ratio|compare savings plans using sequence formulas|explain the difference between a term and a partial sum
limits|estimate a limit from a table and graph|identify a one-sided limit that disagrees|evaluate a removable discontinuity by factoring|explain why a limit can exist without a function value
integration|connect a definite integral to signed area|check a missing constant in an antiderivative|estimate accumulated distance from velocity data|explain how the fundamental theorem links two operations
vectors|resolve a vector into perpendicular components|check a reversed direction in vector subtraction|combine two displacement vectors on a map|explain why vector magnitude is not a sum of components
inequalities|solve an inequality with a negative coefficient|find a reversed boundary on a number line|describe a feasible region for a simple budget|explain why multiplying by a negative flips an inequality
function transformations|predict a graph after a horizontal shift|identify a shift applied in the wrong direction|combine a reflection with a vertical stretch|explain how input changes differ from output changes
complex numbers|multiply complex numbers using a diagram|check a sign after squaring the imaginary unit|solve a quadratic with no real roots|explain complex conjugates through their product
combinatorics|choose between combinations and permutations|find repeated arrangements in a counting argument|count a committee with a membership constraint|explain why order matters in some counting problems
piecewise functions|evaluate a piecewise rule at a boundary|spot overlapping intervals in a definition|model a delivery fee with several pricing bands|explain continuity at a piecewise transition
mathematical modeling|choose variables for a water-tank model|check inconsistent units in a formula|compare a model's prediction with a small data table|explain the limits of a simplifying assumption`,
  Science: `
experimental design|identify a control group in a plant experiment|spot a variable that was changed accidentally|design a fair comparison of paper insulation|explain why repeated trials improve an investigation
measurement|read a scale with the right precision|find a unit conversion that changes the result|compare two ways to measure an irregular object's volume|explain the difference between accuracy and precision
scientific graphs|choose axes for an experimental data table|find a misleading scale in a graph|describe a trend without claiming causation|explain what an error bar can and cannot show
energy transfer|trace energy through a simple warming experiment|spot an energy transfer omitted from a diagram|compare insulation designs using evidence|explain why energy conservation does not mean constant temperature
Earth's seasons|connect Earth's tilt to changing daylight|correct a distance-based explanation of summer|compare daylight patterns in opposite hemispheres|explain a season model using a tilted globe
weather patterns|read pressure changes on a weather map|find a confusion between weather and climate|compare temperature data from coastal and inland sites|explain how a local forecast expresses uncertainty
ecosystems|build a food web from a list of organisms|spot a reversed arrow in an energy diagram|predict possible effects of removing a predator|explain why food-web predictions need evidence
the water cycle|trace water through a watershed diagram|distinguish condensation from evaporation|model how pavement changes surface runoff|explain why groundwater can move slowly
materials|choose properties for comparing everyday materials|identify a claim based on appearance alone|plan a fair test of reusable packaging|explain why one material can suit different uses
astronomy|use a scale model to compare planetary distances|spot a misleading drawing of lunar phases|predict which moon phase rises near sunset|explain why an eclipse does not happen every month
scientific evidence|separate an observation from an inference|identify a conclusion stronger than its data|compare two explanations for the same result|explain what evidence would change a scientific claim
waves|describe wavelength and frequency on a diagram|find a confusion between wave speed and frequency|compare sound patterns from two instruments|explain how a wave transfers energy without carrying matter along
environmental science|define a measurable question about litter|spot sampling bias in a campus waste audit|compare reuse ideas using a simple life-cycle outline|explain why an environmental tradeoff needs several measures`,
  English: `
close reading|choose a short passage that supports an interpretation|find a quotation that does not support a claim|compare two readings of an ambiguous sentence|explain how word choice changes a passage's tone
literary thesis statements|turn a plot observation into an arguable thesis|identify a claim that only summarizes the story|connect a character's decision to a broader theme|explain what would count as evidence against an interpretation
poetry|mark a poem's shifts in speaker and tone|spot a literal reading of a figurative image|compare how line breaks affect two readings|explain a poem's rhythm without reducing it to a pattern
character analysis|trace a character's motivation across scenes|find a contradiction in a character claim|compare two characters facing a similar choice|explain how indirect characterization creates an impression
narrative perspective|identify what a narrator can actually know|spot an assumption based on an unreliable narrator|rewrite a short scene from another viewpoint|explain how perspective affects a reader's sympathy
rhetorical analysis|identify an audience and purpose in a speech|distinguish an emotional appeal from evidence|compare how two speakers address the same concern|explain the effect of a repeated phrase
essay organization|build a paragraph around one interpretive claim|find a paragraph that interrupts the argument|reorder evidence to make a comparison clearer|explain why a transition should connect ideas
quotation integration|introduce a quotation without dropping it into a paragraph|find a quotation that needs more context|blend a short phrase into an analytical sentence|explain the relationship between evidence and commentary
grammar in context|choose a verb tense for a literary analysis|find an unclear pronoun reference|revise parallel items in a comparison sentence|explain how sentence structure changes emphasis
drama|infer a conflict from stage directions|spot a claim that ignores dramatic irony|compare a scene on the page with a performance choice|explain how a pause can change the meaning of dialogue
comparative literature|choose a shared question for two short stories|find an uneven comparison between texts|organize a comparison by idea instead of by book|explain why similar themes can lead to different conclusions
discussion preparation|write an open-ended question about a reading|distinguish a discussion question from a plot quiz|connect a peer's interpretation to textual evidence|explain a disagreement without dismissing another reading`,
  History: `
primary sources|identify the audience of a historical letter|spot a claim that ignores a source's purpose|compare two firsthand accounts of one event|explain why firsthand evidence can still be limited
historical causation|separate a trigger from a long-term cause|find an explanation that treats correlation as cause|rank several causes using evidence from a timeline|explain how causes can interact rather than compete
chronology|build a timeline that supports an argument|find an anachronism in a historical explanation|compare events unfolding in different regions|explain what a timeline leaves out of a story
document-based essays|group documents around an argument|spot a quotation used without source context|connect outside knowledge to a document-based claim|explain how a counterexample can strengthen a history essay
industrialization|trace changes in work using two source types|find an overgeneralization about factory workers|compare industrial growth in two settings|explain an economic change through everyday life
civic movements|identify goals and methods in a reform movement|spot a source that represents only one participant|compare strategies used by two reform groups|explain why a movement's aims can change over time
historical maps|read boundaries and dates on a historical map|find a modern border projected onto an older event|compare trade routes across two periods|explain how map choices influence a historical argument
historical interpretation|distinguish a historian's claim from supporting evidence|identify missing perspectives in an account|compare historians who use different source sets|explain why new evidence can revise an interpretation`,
  "Computer Science": `
binary search|trace the bounds of a binary search|find why binary search misses the final item|adapt binary search to find the first duplicate|explain the loop invariant behind binary search
loops|choose a loop for processing a list|spot an off-by-one error at the end of a loop|handle an empty input without a special crash|explain why a loop terminates
recursion|identify a base case in a recursive function|find a recursive call that makes no progress|trace a recursive directory traversal on paper|explain the call stack using a small example
lists and arrays|choose a list operation for keeping task order|find an index error after deleting an item|remove duplicates while preserving the first occurrence|explain mutation versus creating a new list
dictionaries|count word frequencies with a dictionary|spot a missing-key error in a lookup|group records by a shared field|explain why a lookup table can simplify nested conditionals
sorting|trace one pass of insertion sort|find a comparator that orders equal values badly|sort records by two fields|explain when a stable sort matters
functions|split a long program into small functions|spot a return value lost in a function call|design a function with a clear input contract|explain why a pure function is easier to test
debugging|reduce a bug to a tiny reproducible example|find an assumption hidden in a failing test|choose useful log points without dumping every variable|explain a fix with a before-and-after trace
unit testing|write boundary tests for a score calculator|spot a test that checks the wrong result|test both valid and invalid form inputs|explain why passing examples do not prove correctness
object-oriented design|choose responsibilities for a library-book class|find shared state leaking between instances|model a small game with collaborating objects|explain composition with a concrete example
web accessibility|connect form labels to their controls|find a keyboard trap in a small page|add a useful status message after a form action|explain why color alone cannot convey an error
HTML and CSS|build a responsive card layout|find why a flex item refuses to shrink|adapt a navigation bar to a narrow viewport|explain the box model with measured dimensions
asynchronous code|trace the order of promise callbacks|find a missing await in a data-loading function|handle a failed request while keeping a page usable|explain why asynchronous code is not always parallel
SQL queries|join two tables using a foreign key|find duplicate rows caused by a join|group transactions before filtering their totals|explain the difference between WHERE and HAVING
algorithm complexity|count operations in a nested loop|spot a hidden linear lookup inside a loop|compare two approaches for finding duplicate values|explain time complexity without relying on a stopwatch
graphs|represent a friendship graph with adjacency lists|find a visited-node bug in breadth-first search|trace the shortest unweighted path between nodes|explain why a graph traversal needs a visited set
stacks and queues|choose a queue for a task scheduler|spot a reversed push-and-pop sequence|check balanced brackets with a stack|explain how queue order changes a simulation
file handling|read a small CSV file into structured records|find an error caused by a blank row|validate a file before using its values|explain why a parser should report the failing line
version control|split a small change into understandable commits|resolve a conflict without discarding either edit|compare two branches before combining their work|explain the difference between a commit and a working file
data modeling|choose fields for a simple book tracker|spot duplicated facts in a table design|model a many-to-many relationship with a join table|explain why identifiers should stay stable when labels change`,
  "College Prep": `
college research|compare colleges using a short list of priorities|spot an assumption hidden in a ranking|build a comparison sheet from public program pages|explain which questions a campus visit could answer
application planning|turn an application checklist into weekly tasks|find a deadline dependency in a sample calendar|plan around several overlapping essay deadlines|explain how to keep a realistic application buffer
personal essay ideas|choose a small experience worth reflecting on|spot an essay idea that lists achievements without meaning|compare two possible themes for a personal essay|explain what a reader should learn from one story
essay outlines|outline a personal essay around a turning point|find a paragraph that does not serve the central idea|connect reflection to a concrete scene|explain why an ending should add insight
activity descriptions|describe an activity with specific actions|spot vague wording in an activity summary|prioritize details within a short word limit|explain a contribution without inflating its impact
recommendation preparation|organize a concise reflection sheet for a teacher|find an example that says little about learning|draft a respectful recommendation request|explain which details help a recommender write specifically
college interviews|prepare a thoughtful answer about an academic interest|spot an answer that sounds memorized|practice a follow-up question in a mock interview|explain an unfamiliar project to a new listener
program exploration|compare course lists for two possible majors|find a difference between a major title and its requirements|plan questions for a department information session|explain how an elective could test an academic interest
campus communities|identify support resources from a public campus site|spot a broad claim about campus fit|compare ways to join a campus learning community|explain what matters in a first-year transition
application revision|build a revision checklist for a short response|find an answer that misses part of a prompt|trim a response while keeping its specific example|explain the difference between proofreading and revising
transfer pathways|map questions to ask about a transfer pathway|spot an assumption about whether credits will transfer|compare public pathway descriptions without guessing eligibility|explain why official advising is needed for a transfer plan
workload planning|compare a sample course schedule with outside commitments|spot a schedule that has no study time|build a weekly plan that includes travel and breaks|explain how to revise a plan after a busy week
college vocabulary|distinguish a prerequisite from a corequisite|spot a confusion between a certificate and a degree|make a glossary from public college catalog terms|explain a sample course sequence in plain language
information sessions|prepare questions that are not answered on a website|find a question that is too broad for a short session|organize notes from two sample information sessions|explain how to follow up on an unanswered question`,
  "SAT/ACT": `
reading evidence|choose the sentence that directly supports a reading answer|spot an answer that goes beyond the passage|compare two plausible evidence choices|explain why a tempting reading distractor fails
vocabulary in context|infer a word's meaning from nearby sentences|spot a familiar definition that does not fit|compare the tone of two replacement words|explain how context narrows a word's meaning
sentence boundaries|separate two independent clauses correctly|find a comma splice in a practice sentence|choose punctuation for a sentence with a transition|explain why a semicolon works between two clauses
transitions|choose a transition that matches the argument|spot a contrast word used for a supporting example|compare transition choices in a short paragraph|explain the relationship between two adjacent ideas
linear equations|translate a test word problem into an equation|find a unit mismatch in a linear model|solve a rate problem using a table|explain what a slope represents in context
percentages|identify the original amount in a percent-change problem|spot a percent increase applied to the wrong base|compare consecutive discounts with a single discount|explain why reversing a percent increase takes a different rate
ratios|set up a proportion from a scale drawing|find a ratio whose quantities are reversed|solve a mixture question using a table|explain why units must align in a proportion
quadratic graphs|read a parabola's vertex in a practice problem|spot an intercept confused with a vertex|choose an equation matching a quadratic graph|explain what a quadratic parameter changes
data interpretation|read a table before comparing answer choices|find a percentage calculated with the wrong denominator|combine information from a graph and a short passage|explain a data claim using only the evidence shown
timed practice|build a pacing plan from a short practice set|spot a habit that uses time without improving accuracy|compare skipping strategies in two practice sessions|explain how an error log can guide the next session
mental estimation|estimate an answer before doing detailed arithmetic|find an answer with an unreasonable order of magnitude|compare two shortcuts for a proportion problem|explain when an estimate can eliminate a choice
equivalent expressions|recognize two algebraically equivalent expressions|spot a distribution error in parentheses|choose a useful form of an expression for a word problem|explain an algebraic transformation step by step
scientific passages|identify a variable from an ACT-style experiment summary|find a conclusion that contradicts the graph|compare two experiment setups using a table|explain the difference between a result and a prediction
practice review|sort missed practice questions by reasoning error|spot an answer copied without understanding the method|turn a missed problem into a new practice question|explain a corrected solution without looking at the answer key`,
  "AP Courses": `
AP workload|build a weekly plan for two demanding classes|spot a study plan that leaves no review time|balance a long assignment with short practice tasks|explain how to adjust a study plan after feedback
free-response practice|break a free-response prompt into separate tasks|find a response that misses an instruction verb|compare an outline with a public scoring example|explain how evidence earns support for a claim
AP history writing|write a defensible thesis for a historical prompt|spot summary where a history essay needs analysis|connect contextual information to a document argument|explain a line of reasoning across several paragraphs
AP literature discussion|build an interpretation from a short passage|find a literary claim unsupported by a quotation|compare two plausible interpretations of an image|explain how form contributes to meaning
AP language rhetoric|identify a writer's audience and purpose|spot a list of devices without analysis|connect a rhetorical choice to its effect|explain how a concession supports an argument
AP biology models|label matter and energy in a biology model|find a diagram that confuses a process with its result|use a model to predict a biological change|explain a model's limitations in a short response
AP chemistry reasoning|connect particle diagrams to a macroscopic observation|find an explanation that confuses amount with concentration|compare two reaction setups using evidence|explain a chemistry trend without memorized slogans
AP physics representations|connect a motion graph to a physical description|spot an inconsistent force diagram|use multiple representations for the same motion problem|explain which assumptions a physics solution needs
AP calculus explanations|justify a calculus answer with the relevant condition|find a theorem applied outside its assumptions|connect a derivative graph to a function's behavior|explain a conclusion in a complete mathematical sentence
AP statistics investigations|identify the parameter in a statistics question|spot an inference made from a biased sample|choose a suitable graph for a class investigation|explain a statistical conclusion in context
AP computer science traces|trace object state through a short method|find a boundary error in an array traversal|design test cases for a small class|explain a method's purpose without narrating every line
AP environmental evidence|connect a data trend to an environmental claim|find a solution that ignores a stated constraint|compare environmental proposals using several criteria|explain an environmental tradeoff with a labeled diagram
AP study groups|plan a study session where everyone explains a step|spot a review routine that only repeats notes|turn a concept list into retrieval questions|explain how to use peer feedback before the next assessment`,
  Spanish: `
Spanish past tenses|choose between the preterite and imperfect in a story|find a tense shift that changes a scene's meaning|describe a repeated habit and one completed event|explain how background and action work together in narration
Spanish object pronouns|place an object pronoun in a short sentence|spot a direct object mistaken for an indirect object|combine two object pronouns in a dialogue|explain what a pronoun replaces in context
Spanish conversation|ask follow-up questions in a casual Spanish dialogue|find a phrase translated too literally from English|practice explaining an unfamiliar word in Spanish|explain a daily routine without reading a script
Spanish agreement|match adjectives to nouns in a description|find agreement errors after a plural noun|describe two contrasting places in a short paragraph|explain how adjective placement can change emphasis
Spanish commands|form a respectful request in Spanish|spot a command that uses the wrong person|write clear directions for a simple activity|explain the difference between a suggestion and a command
Spanish reading|use context clues in a short Spanish article|find a false friend that changes a sentence's meaning|summarize a short passage without translating every word|explain which details support a Spanish reading inference
Spanish subjunctive|recognize a sentence expressing a wish|spot an indicative form in a statement of doubt|write a short exchange about future possibilities|explain why certainty changes a verb choice`,
  Arts: `
color palettes|choose a limited palette for a digital illustration|spot colors competing with the focal point|compare warm and cool versions of the same scene|explain how value contrast guides the viewer
composition|place a focal point in a thumbnail sketch|find a tangent that makes a drawing confusing|reframe a scene using negative space|explain why an off-center composition can feel balanced
perspective drawing|place vanishing points for a simple street scene|spot edges that disagree about perspective|draw a room from a new viewing angle|explain how the horizon line relates to eye level
observational drawing|break an everyday object into basic shapes|find a proportion error using a reference line|draw the same object under different lighting|explain which details matter most to a quick sketch
visual storytelling|plan a short sequence of wordless panels|spot a panel transition that skips essential information|show a change in mood through framing|explain how a visual cue helps the reader follow time
art critique|describe a design choice before judging it|find feedback that is too vague to act on|compare two revisions against the artist's goal|explain a personal response using visible evidence
digital layers|organize layers for a small illustration|find an adjustment affecting the wrong layer|test a nondestructive color change|explain why keeping a sketch separate helps revision`,
  Music: `
rhythm reading|count a syncopated rhythm slowly|find a missing subdivision in a measure|clap a rhythm against a steady pulse|explain how a rest changes the placement of an accent
chord progressions|identify the chords in a simple progression|spot a chord tone that does not fit the harmony|write a short progression with a clear ending|explain why tension makes a resolution feel complete
ear training|compare two intervals by singing their notes|find which note changed in a short melody|transcribe a brief rhythm by repeated listening|explain a listening strategy for distinguishing major and minor
practice planning|choose a small goal for an instrument practice session|spot a section being repeated without improvement|divide a difficult phrase into useful chunks|explain how slow practice supports a faster performance
melody writing|build a melody from a short musical motif|find a leap that makes a phrase hard to sing|vary a motif while keeping it recognizable|explain how a phrase's ending creates closure
ensemble listening|follow a supporting part while hearing the melody|spot an entrance that is late relative to the pulse|mark listening cues for a rehearsal passage|explain how balance changes when the melody moves
music notation|read a key signature before starting a passage|find an accidental that was carried too far|rewrite a short rhythm with clearer beaming|explain why notation should help a performer hear the phrase`,
  Sports: `
team communication|give a clear call during a passing drill|spot feedback that confuses a teammate|plan a short team check-in after practice|explain how a specific cue improves coordination
game observation|track ball movement in a short game clip|find a conclusion drawn from a single play|compare two defensive formations on a diagram|explain a tactical choice using positions and space
practice organization|organize a simple non-contact skill station|spot a drill schedule with too much waiting|plan a rotation that gives everyone a turn|explain how a practice goal determines the drill
goal setting|set a measurable teamwork goal for practice|find a goal that depends entirely on winning|track progress with a short practice journal|explain how to adjust a goal after feedback
sportsmanship|prepare a respectful response to a disputed call|spot language that escalates a team disagreement|role-play welcoming a new teammate|explain how competition and fair play can support each other`,
  "Mental Health": `
study routines|plan short study blocks during a busy exam week|spot a weekly plan with no realistic breaks|build a small restart routine after missing a study session|explain what makes an accountability check-in helpful
asking for support|prepare a simple request for academic help|find a help request that is too vague to answer|practice asking a trusted adult about school support options|explain the difference between peer encouragement and professional support
digital boundaries|choose a quiet study period without phone notifications|spot a reminder system that creates more distraction|compare two practical ways to end a scrolling break|explain a personal device boundary respectfully to a friend
manageable goals|break an overwhelming assignment into a first action|find an all-or-nothing goal that is hard to restart|plan a low-pressure check-in with a study partner|explain how to recognize progress without comparing grades
school transitions|plan a simple routine for the first week of a new class|spot unanswered practical questions before a schedule change|make a list of school resources to ask about|explain a new routine to a supportive peer
rest and workload|make room for breaks in a demanding homework plan|spot optional tasks that can wait until tomorrow|compare two ways to distribute a large assignment|explain why a study plan should allow adjustments`,
  "Career Guidance": `
career exploration|compare daily tasks in two possible careers|spot an assumption based only on a job title|build questions for a career information interview|explain which work activities connect to an interest
resume basics|describe a class project on a first resume|find a resume bullet that needs a concrete action|organize a resume without paid work experience|explain a skill using a small project example
interview practice|prepare a short introduction for a practice interview|spot an answer that does not address the question|describe a challenge using a clear situation and action|explain what was learned from a team disagreement
project portfolios|choose a project to include in a beginner portfolio|find a project description missing the student's contribution|organize a portfolio page around a problem and result|explain a project to someone outside the subject
workplace communication|write a clear request for a project update|spot an email subject that hides the purpose|practice asking for clarification on an unfamiliar task|explain a delay with a realistic next step
career research|find reliable public information about a career pathway|spot an unsupported claim in a career advertisement|compare training routes without assuming one is best|explain which pathway questions need official advice
teamwork reflection|identify a specific contribution to a group project|find feedback that describes personality instead of behavior|plan a fair division of tasks for a small project|explain how to ask for help before missing a deadline
skill development|choose a small project to explore an unfamiliar skill|spot a learning goal too broad for one month|build a practice plan with a visible finished result|explain how feedback can shape the next project
networking practice|introduce an academic interest in a short conversation|find a follow-up message that asks too much at once|draft a thank-you note after a practice career conversation|explain how to keep a professional conversation focused`,
  Engineering: `
design criteria|turn a design brief into measurable requirements|spot a constraint left out of a prototype plan|compare two designs using a decision matrix|explain a tradeoff between cost and performance
bridge models|sketch load paths through a model bridge|find a weak joint in a paper bridge design|compare truss arrangements using a simple model|explain how triangular bracing changes stability
CAD sketches|constrain a simple shape in a CAD sketch|spot an unintended degree of freedom|revise a model when one dimension changes|explain the difference between a dimension and a constraint
prototyping|choose a low-cost material for a first prototype|find a test that measures the wrong design goal|plan an iteration after a prototype fails|explain what a rough prototype can teach before polishing
circuits|draw a simple circuit with a switch and lamp|spot a missing return path in a circuit diagram|compare series and parallel lamp arrangements|explain why a circuit diagram is different from physical layout
mechanisms|trace motion through a pair of gears|find a gear ratio applied in the wrong direction|design a linkage to change a motion's direction|explain the tradeoff between speed and torque
engineering notebooks|record a test so another student could repeat it|find a notebook entry missing the design change|compare prototype results with a consistent table|explain how documenting failure helps the next iteration
sustainable design|choose criteria for comparing reusable containers|spot a design claim that ignores material use|compare packaging prototypes under the same test|explain a design tradeoff without claiming a perfect solution`,
  Biology: `
cell transport|predict water movement across a membrane|spot a confusion between diffusion and active transport|compare cell behavior in two solutions|explain why concentration gradients matter
genetics|set up a simple inheritance cross|find a genotype confused with a phenotype|interpret a pedigree without assuming every trait is simple|explain probability versus certainty in inheritance
photosynthesis|trace carbon atoms through a photosynthesis model|spot an incorrect source of a plant's added mass|compare plant growth under controlled light conditions|explain the connection between light reactions and sugar production
cellular respiration|track energy transfers during cellular respiration|find oxygen's role misplaced in a pathway diagram|compare aerobic respiration with fermentation|explain why cells do not release all energy in one step
evolution|identify evidence for natural selection in a population|spot an explanation that says individuals evolve on purpose|compare how a trait's usefulness changes by environment|explain why variation matters before selection occurs
ecology|interpret a population growth graph|find a limiting factor missing from an explanation|compare density-dependent and independent effects|explain why a carrying-capacity model is simplified
cell division|follow chromosome copies through mitosis|spot a confusion between chromosomes and chromatids|compare the outcomes of mitosis and meiosis|explain how meiosis contributes to variation
biological experiments|identify variables in an enzyme investigation|find a control condition missing from a biology experiment|plan repeated measurements for a germination study|explain why a biological claim needs more than one observation`,
  Chemistry: `
stoichiometry|use a balanced equation to set up mole ratios|find a mass ratio used where a mole ratio is needed|calculate a limiting reactant from two starting amounts|explain why excess reactant can remain after a reaction
redox reactions|assign oxidation numbers in a reaction|spot electrons that do not balance between half-reactions|balance a redox equation in acidic solution|explain how charge and atoms are checked separately
chemical bonding|compare ionic and covalent bonding models|find an octet rule applied without checking the context|draw a Lewis structure and compare possible arrangements|explain how bonding models account for material properties
solutions|convert between moles and concentration|spot a dilution calculation using the wrong final volume|plan a safe paper-only dilution calculation|explain why dilution changes concentration but not solute amount
acid-base chemistry|connect pH to relative hydrogen-ion concentration|find a tenfold change mistaken for a small linear change|compare the purpose of an indicator and a pH meter|explain what neutralization does at the particle level
equilibrium|interpret forward and reverse rates at equilibrium|spot a claim that equilibrium means equal concentrations|predict a shift after a concentration change|explain why dynamic equilibrium still involves reactions
thermochemistry|interpret the sign of an enthalpy change|find a system boundary missing from an energy explanation|compare two reaction-energy diagrams|explain why bond breaking and bond forming affect energy differently
gas laws|choose a gas-law relationship from changing variables|spot Celsius substituted into a proportional temperature calculation|compare pressure-volume predictions at constant temperature|explain a gas-law trend with a particle model
reaction rates|identify a rate from a concentration-time graph|find a catalyst described as changing the reaction's final energy|compare rate changes caused by concentration and temperature|explain collision theory with a clear particle sketch`,
  Physics: `
motion graphs|connect a velocity graph to displacement|spot acceleration confused with velocity|sketch motion from a short position description|explain why area and slope answer different motion questions
force diagrams|draw forces acting on an object on a slope|find a force paired with the wrong object|compare diagrams before and after a rope goes slack|explain why motion alone does not identify the net force
energy conservation|choose a system boundary for an energy problem|spot friction omitted from an energy account|compare two paths between the same heights|explain when mechanical energy is not conserved
momentum|set up momentum conservation for a collision|find velocity signs that disagree with a chosen direction|compare elastic and inelastic collision models|explain why momentum can be conserved when kinetic energy is not
projectile motion|separate horizontal and vertical motion|spot an acceleration added to the horizontal direction|predict how launch height changes flight time|explain why two components share the same time
electric circuits|relate current and voltage in a simple circuit|find current assumed to disappear after a resistor|compare equivalent resistance in two circuit layouts|explain the difference between potential difference and current
waves and sound|relate wavelength to wave speed and frequency|spot a louder sound confused with a higher pitch|compare standing-wave patterns on a string|explain why a boundary changes a reflected wave
torque|choose a pivot for a balance problem|find a force distance measured along the wrong direction|compare ways to balance an uneven lever|explain why force alone does not determine turning effect
measurement uncertainty|estimate uncertainty in a length measurement|spot too many significant figures in a result|compare repeated measurements with an instrument's resolution|explain how uncertainty affects a physical conclusion`,
  Writing: `
argument development|turn a broad opinion into a focused claim|find evidence that is related but not persuasive|build a counterargument that treats another view fairly|explain how a claim changes after considering evidence
paragraph revision|write a topic sentence that makes a point|spot a paragraph trying to do too many jobs|reorder sentences so the reasoning unfolds clearly|explain why an example needs commentary
personal narratives|choose a small moment for a short narrative|find a passage that tells a feeling without showing its cause|add sensory details that serve the story|explain how reflection changes the meaning of an event
concise prose|replace vague wording with a specific action|find a sentence hiding its main idea|trim a paragraph without losing its reasoning|explain why a shorter sentence is sometimes clearer
research writing|organize notes around a research question|spot a paraphrase that stays too close to its source|combine two sources in one analytical paragraph|explain how to distinguish a source's claim from my own
introductions|open an essay with a question the argument will answer|find an opening broader than the essay can support|connect background information to a focused thesis|explain what a reader needs before the main claim
conclusions|return to an essay's central question with new insight|spot a conclusion that only repeats the introduction|connect the argument to a specific implication|explain how to end without making an unsupported claim
peer feedback|ask for feedback on one revision goal|find a comment that judges without giving evidence|turn peer feedback into a short revision plan|explain why a suggested edit does or does not fit the purpose
creative dialogue|give two characters distinct ways of speaking|spot dialogue that exists only to explain background|revise a conversation so the conflict emerges indirectly|explain how a pause or action can replace a line of dialogue`,
  Research: `
research questions|turn a broad topic into an answerable research question|spot a question that assumes its own conclusion|narrow a question to fit the available time and sources|explain what evidence would answer a research question
source evaluation|identify the author and purpose of a source|find a claim supported only by another unsourced claim|compare a primary source with a later summary|explain why relevance and reliability are different checks
search strategies|choose keywords for an unfamiliar topic|spot a search that repeats the same narrow viewpoint|build a search log that records useful changes|explain how one source can suggest better search terms
research notes|separate quotations from paraphrases in notes|find notes missing the source needed for a citation|organize evidence by claim instead of by website|explain how note structure reduces accidental plagiarism
small investigations|choose an observation method for a class project|spot a sampling plan that excludes important cases|compare findings while acknowledging a small sample|explain a study's limitations without dismissing its value`,
};
