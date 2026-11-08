// Demo account content: original sample study material (Class 10 Biology, "Life Processes"),
// a pre-built topic map, and two past quiz attempts so judges can see the full loop
// (gap report, plan, progress) immediately — without spending any API calls.
import type { AgentRun, Attempt, Difficulty, Evaluation, Material, MaterialKind, QuizQuestion, StudentData, Topic } from "./types";
import { citeLabel, emptyData } from "./types";
import { chunkMaterial } from "./chunk";
import { Retriever, attachTopicSources, extractPastQuestionsDetailed, mapQuestionsToTopics } from "./retrieval";
import { detectKind, fingerprint } from "./ingest";
import { buildGapReport } from "./analysis";
import { buildPlan } from "./planner";

export const DEMO_EMAIL = "demo@gapfinder.ai";
export const DEMO_PASSWORD = "demo1234";

const SYLLABUS = `Class 10 Biology - Life Processes: Syllabus
Unit 1: Nutrition and Photosynthesis
Autotrophic nutrition, photosynthesis, light reaction, dark reaction (Calvin cycle), stomata and gas exchange, heterotrophic nutrition (holozoic, saprophytic, parasitic).
Unit 2: Human Digestive System
Mouth and saliva, stomach (hydrochloric acid, pepsin, mucus), small intestine (bile, pancreatic juice, villi), large intestine.
Unit 3: Respiration
Aerobic respiration, anaerobic respiration (yeast and muscle cells), ATP, human respiratory system, alveoli.
Unit 4: Transportation
Human heart, double circulation, blood vessels (arteries, veins, capillaries), platelets and lymph, transport in plants (xylem, phloem, transpiration, translocation).
Unit 5: Excretion
Human excretory system, nephron, formation of urine, dialysis, excretion in plants.`;

const NOTES_P1 = `Chapter 6: Life Processes

6.1 Autotrophic Nutrition
All living things need energy to stay alive, and they get it from food. Green plants make their own food from simple inorganic substances, so their mode of nutrition is called autotrophic. The process is called photosynthesis. The raw materials are carbon dioxide, taken from the air through the leaves, and water, absorbed by the roots. Chlorophyll in the chloroplasts absorbs sunlight. The overall equation is 6CO2 + 12H2O gives C6H12O6 + 6O2 + 6H2O, in the presence of sunlight and chlorophyll.

6.2 Light Reaction
The light reaction takes place in the thylakoid membranes (grana) of the chloroplast. Chlorophyll absorbs light energy. This energy splits water molecules into hydrogen and oxygen; this is called photolysis of water. The oxygen is released into the air as a by-product. The light energy is converted into chemical energy and stored as ATP and NADPH.

6.3 Dark Reaction (Calvin Cycle)
The dark reaction occurs in the stroma of the chloroplast and does not directly need light. It uses ATP and NADPH from the light reaction to reduce carbon dioxide into glucose. Desert plants open their stomata only at night, take in carbon dioxide and store it as an acid, which is then used during the day.

6.4 Stomata and Gas Exchange
Stomata are tiny pores found mostly on the lower surface of leaves. Each pore is surrounded by two guard cells. When the guard cells swell with water the pore opens; when they lose water the pore closes. Stomata allow the exchange of oxygen and carbon dioxide, and a large amount of water is also lost as water vapour through them.

6.5 Heterotrophic Nutrition
Organisms that cannot make their own food depend on others. In holozoic nutrition, food is taken in and digested inside the body, as in humans. In saprophytic nutrition, organisms such as fungi break down dead matter outside the body and absorb it. In parasitic nutrition, organisms such as Cuscuta and tapeworms take food from a living host. Amoeba takes in food using pseudopodia, forming a food vacuole.

6.6 Human Digestive System
In the mouth, teeth chew the food and saliva contains salivary amylase, which breaks down starch into sugar. Food moves down the oesophagus by rhythmic muscle movements called peristalsis. In the stomach, gastric glands release hydrochloric acid, pepsin and mucus. HCl creates an acidic medium for pepsin and kills germs, while mucus protects the stomach lining from the acid. The small intestine is the longest part of the gut. It receives bile from the liver, which emulsifies fats, and pancreatic juice containing trypsin for proteins and lipase for fats. Villi increase the surface area for absorption of digested food into the blood. The large intestine absorbs excess water.`;

const NOTES_P2 = `6.7 Respiration
In aerobic respiration, glucose is first broken down in the cytoplasm into pyruvate, a three-carbon molecule. In the mitochondria, in the presence of oxygen, pyruvate is broken down into carbon dioxide and water, releasing a large amount of energy. In anaerobic respiration in yeast, pyruvate is converted into ethanol and carbon dioxide; this is fermentation. In muscle cells, when oxygen is short during heavy exercise, pyruvate is converted into lactic acid, which causes muscle cramps. The energy released is stored as ATP, the energy currency of the cell.

6.8 Human Respiratory System
Air enters through the nostrils, where it is filtered by fine hairs and mucus. It passes through the pharynx, larynx and trachea; rings of cartilage keep the trachea from collapsing. The trachea divides into bronchi, then bronchioles, which end in alveoli. The alveoli are balloon-like structures with very thin walls and a dense network of blood capillaries, which makes them the site of gas exchange. Haemoglobin in red blood cells carries oxygen to the tissues.

6.9 Transportation in Humans
The human heart has four chambers. The right side receives deoxygenated blood and the left side receives oxygenated blood. Oxygenated blood from the lungs enters the left atrium, passes to the left ventricle, and the left ventricle pumps it to the body through the aorta. Keeping the right and left sides separate prevents oxygenated and deoxygenated blood from mixing, which gives the efficient oxygen supply that warm-blooded animals need. Blood passes through the heart twice in each cycle; this is called double circulation. Arteries carry blood away from the heart and have thick elastic walls. Veins carry blood to the heart and have valves. Capillaries have walls only one cell thick. Platelets help the blood to clot at a wound. Lymph carries digested fat and drains excess fluid back into the blood.`;

const NOTES_P3 = `6.10 Transportation in Plants
Xylem transports water and minerals from the roots to the leaves. Evaporation of water from the leaves creates a suction called transpiration pull, which draws water up in tall plants. Phloem transports food, mainly sucrose, from the leaves to other parts; this is called translocation and it uses energy from ATP.

6.11 Excretion in Humans
The excretory system has two kidneys, two ureters, a urinary bladder and a urethra. The nephron is the basic filtering unit of the kidney. Blood is filtered in the glomerulus, a cluster of capillaries inside the cup-shaped Bowman's capsule. Useful substances such as glucose, amino acids, salts and water are selectively reabsorbed in the tubule. The remaining liquid, urine, collects in the bladder. The amount of water reabsorbed depends on how much excess water the body has. If the kidneys fail, dialysis with an artificial kidney removes nitrogenous wastes from the blood.

6.12 Excretion in Plants
Plants release oxygen from photosynthesis and remove excess water by transpiration. Many wastes are stored in leaves that later fall off, and others are stored as resins and gums in old xylem.`;

const PAST_PAPER = `Class 10 Board Examination - Science (Biology section) - Previous Years
Q1. What is photolysis of water? Where does it take place in the chloroplast? [2 marks]
Q2. Explain the role of hydrochloric acid and mucus in the stomach. [3 marks]
Q3. How do guard cells regulate the opening and closing of stomatal pores? [2 marks]
Q4. Why do muscle cells get cramps during vigorous exercise? Explain with the pathway of glucose breakdown. [3 marks]
Q5. Describe double circulation in human beings. Why is it necessary? [5 marks]
Q6. Draw the structure of a nephron and explain how urine is formed. [5 marks]
Q7. What are the differences between the light reaction and the dark reaction of photosynthesis? [3 marks]
Q8. How are the alveoli designed to maximise the exchange of gases? [2 marks]
Q9. What are villi? How do they help in absorption of digested food? [2 marks]
Q10. Name the raw materials of photosynthesis and write the balanced equation. [2 marks]
Q11. How is water transported from roots to leaves in tall plants? [3 marks]
Q12. Which substances are reabsorbed in the tubule of the nephron? [2 marks]`;

const TOPICS: Omit<Topic, "examWeight" | "sourceChunkIds">[] = [
  {
    id: "t_nut",
    description: "How green plants make food by photosynthesis (light and dark reactions), how gases enter through stomata, and how other organisms obtain food.",
    learningObjectives: ["Explain where and how the light and dark reactions occur", "Describe how guard cells open and close stomata", "Compare autotrophic and heterotrophic nutrition"],
    prerequisites: [],
    name: "Nutrition and Photosynthesis",
    subtopics: ["Autotrophic nutrition", "Light reaction", "Dark reaction", "Stomata", "Heterotrophic nutrition"],
    keywords: ["photosynthesis", "chlorophyll", "chloroplast", "photolysis", "guard cells", "carbon dioxide"],
  },
  {
    id: "t_dig",
    description: "How food is broken down and absorbed along the human gut, from saliva to villi.",
    learningObjectives: ["Describe the role of enzymes and HCl in digestion", "Explain how villi help absorption"],
    prerequisites: [],
    name: "Human Digestive System",
    subtopics: ["Mouth and saliva", "Stomach", "Small intestine", "Villi"],
    keywords: ["digestion", "amylase", "pepsin", "hydrochloric acid", "bile", "villi", "intestine"],
  },
  {
    id: "t_resp",
    description: "How cells release energy from glucose with and without oxygen, and how the lungs exchange gases.",
    learningObjectives: ["Trace the breakdown of glucose in aerobic and anaerobic respiration", "Explain why alveoli are suited to gas exchange"],
    prerequisites: ["t_dig", "t_nut"],
    name: "Respiration",
    subtopics: ["Aerobic respiration", "Anaerobic respiration", "Human respiratory system", "Alveoli"],
    keywords: ["pyruvate", "mitochondria", "lactic acid", "fermentation", "ATP", "alveoli", "trachea", "cramps"],
  },
  {
    id: "t_trans",
    description: "How blood is pumped and carried in humans, and how water and food move in plants.",
    learningObjectives: ["Trace the path of blood through the four chambers of the heart", "Explain double circulation", "Explain transpiration pull and translocation"],
    prerequisites: ["t_resp"],
    name: "Transportation",
    subtopics: ["Human heart", "Double circulation", "Blood vessels", "Transport in plants"],
    keywords: ["heart", "ventricle", "atrium", "arteries", "veins", "xylem", "phloem", "transpiration", "circulation"],
  },
  {
    id: "t_exc",
    description: "How the kidneys filter blood and form urine, and how plants get rid of wastes.",
    learningObjectives: ["Describe the structure of a nephron", "Explain filtration and selective reabsorption", "Describe excretion in plants"],
    prerequisites: ["t_trans"],
    name: "Excretion",
    subtopics: ["Nephron", "Formation of urine", "Dialysis", "Excretion in plants"],
    keywords: ["kidney", "nephron", "glomerulus", "Bowman's capsule", "urine", "reabsorbed", "dialysis"],
  },
];

type SeedQ = {
  key: string;
  topicId: string;
  subtopic: string;
  type: "mcq" | "short" | "true_false" | "multi_select";
  difficulty?: Difficulty;
  marks?: number;
  question: string;
  options?: string[];
  answerIndex?: number;
  answerIndices?: number[];
  rubric?: string[];
  modelAnswer: string;
  explanation: string;
  quote: string; // must appear verbatim in the notes
};

const POOL: SeedQ[] = [
  {
    key: "q1", topicId: "t_nut", subtopic: "Light reaction", type: "mcq",
    question: "Where in the chloroplast does the light reaction of photosynthesis take place?",
    options: ["Stroma", "Thylakoid membranes (grana)", "Mitochondria", "Cytoplasm"], answerIndex: 1,
    modelAnswer: "Thylakoid membranes (grana)",
    explanation: "Your notes state the light reaction happens in the thylakoid membranes (grana); the stroma is where the dark reaction happens.",
    quote: "The light reaction takes place in the thylakoid membranes (grana) of the chloroplast.",
  },
  {
    key: "q2", topicId: "t_nut", subtopic: "Light reaction", type: "short", difficulty: "medium", marks: 2, rubric: ["Water is split", "Using light energy absorbed by chlorophyll", "Oxygen released as by-product"],
    question: "What is photolysis of water?",
    modelAnswer: "Light energy absorbed by chlorophyll splits water molecules into hydrogen and oxygen; the oxygen is released as a by-product.",
    explanation: "Photolysis = splitting of water by light energy during the light reaction.",
    quote: "This energy splits water molecules into hydrogen and oxygen; this is called photolysis of water.",
  },
  {
    key: "q3", topicId: "t_nut", subtopic: "Dark reaction", type: "mcq", difficulty: "medium",
    question: "Which products of the light reaction are used in the dark reaction?",
    options: ["Oxygen and water", "ATP and NADPH", "Glucose and oxygen", "Carbon dioxide only"], answerIndex: 1,
    modelAnswer: "ATP and NADPH",
    explanation: "The dark reaction uses ATP and NADPH from the light reaction to reduce carbon dioxide into glucose.",
    quote: "It uses ATP and NADPH from the light reaction to reduce carbon dioxide into glucose.",
  },
  {
    key: "q4", topicId: "t_nut", subtopic: "Stomata", type: "true_false", difficulty: "easy",
    question: "True or false: when the guard cells lose water, the stomatal pore opens.",
    options: ["True", "False"], answerIndex: 1,
    modelAnswer: "False — the pore closes",
    explanation: "Swollen guard cells open the pore; when they lose water the pore closes.",
    quote: "When the guard cells swell with water the pore opens; when they lose water the pore closes.",
  },
  {
    key: "q5", topicId: "t_dig", subtopic: "Stomach", type: "short", difficulty: "medium", marks: 2, rubric: ["Creates acidic medium for pepsin", "Kills germs"],
    question: "Give two functions of hydrochloric acid in the stomach.",
    modelAnswer: "It creates an acidic medium in which pepsin can act, and it kills germs that enter with food.",
    explanation: "HCl provides the acidic medium for pepsin and kills germs; mucus (not HCl) protects the lining.",
    quote: "HCl creates an acidic medium for pepsin and kills germs",
  },
  {
    key: "q6", topicId: "t_dig", subtopic: "Villi", type: "mcq",
    question: "What is the main role of villi in the small intestine?",
    options: ["Secrete bile", "Increase the surface area for absorption", "Digest starch", "Absorb only water"], answerIndex: 1,
    modelAnswer: "Increase the surface area for absorption",
    explanation: "Villi increase the surface area for absorbing digested food into the blood.",
    quote: "Villi increase the surface area for absorption of digested food into the blood.",
  },
  {
    key: "q7", topicId: "t_resp", subtopic: "Anaerobic respiration", type: "mcq", difficulty: "medium",
    question: "What causes muscle cramps during heavy exercise?",
    options: ["Build-up of ethanol", "Build-up of lactic acid", "Excess carbon dioxide", "Excess oxygen"], answerIndex: 1,
    modelAnswer: "Build-up of lactic acid",
    explanation: "When oxygen is short, muscle cells convert pyruvate into lactic acid, which causes cramps. Ethanol is made by yeast, not muscles.",
    quote: "pyruvate is converted into lactic acid, which causes muscle cramps",
  },
  {
    key: "q8", topicId: "t_resp", subtopic: "Aerobic respiration", type: "short", difficulty: "hard", marks: 3, rubric: ["In the mitochondria", "Needs oxygen", "Products: carbon dioxide and water", "Large amount of energy released"],
    question: "In aerobic respiration, where is pyruvate broken down and what are the products?",
    modelAnswer: "In the mitochondria, in the presence of oxygen, into carbon dioxide and water, releasing a large amount of energy.",
    explanation: "Glycolysis (glucose to pyruvate) is in the cytoplasm; the breakdown of pyruvate with oxygen happens in mitochondria.",
    quote: "In the mitochondria, in the presence of oxygen, pyruvate is broken down into carbon dioxide and water",
  },
  {
    key: "q12", topicId: "t_resp", subtopic: "Alveoli", type: "mcq",
    question: "Which feature makes the alveoli suited to gas exchange?",
    options: ["Thick muscular walls", "Rings of cartilage", "Very thin walls with a dense network of capillaries", "Fine hairs and mucus"], answerIndex: 2,
    modelAnswer: "Very thin walls with a dense network of capillaries",
    explanation: "Thin walls and many capillaries allow fast diffusion of gases. Cartilage rings belong to the trachea.",
    quote: "The alveoli are balloon-like structures with very thin walls and a dense network of blood capillaries",
  },
  {
    key: "q9", topicId: "t_trans", subtopic: "Human heart", type: "mcq",
    question: "Which chamber of the heart pumps oxygenated blood to the body?",
    options: ["Right atrium", "Right ventricle", "Left atrium", "Left ventricle"], answerIndex: 3,
    modelAnswer: "Left ventricle",
    explanation: "Oxygenated blood goes left atrium → left ventricle → aorta → body.",
    quote: "the left ventricle pumps it to the body through the aorta",
  },
  {
    key: "q10", topicId: "t_trans", subtopic: "Double circulation", type: "short", difficulty: "hard", marks: 2, rubric: ["Prevents mixing of oxygenated and deoxygenated blood", "Efficient oxygen supply needed by warm-blooded animals"],
    question: "Why is it useful for mammals that oxygenated and deoxygenated blood do not mix?",
    modelAnswer: "It gives an efficient supply of oxygen to the body, which warm-blooded animals need to maintain body temperature.",
    explanation: "Separation of the two sides of the heart prevents mixing and ensures efficient oxygen supply.",
    quote: "Keeping the right and left sides separate prevents oxygenated and deoxygenated blood from mixing",
  },
  {
    key: "q11", topicId: "t_exc", subtopic: "Formation of urine", type: "multi_select", difficulty: "medium", marks: 2,
    question: "Which of these are selectively reabsorbed in the tubule of the nephron? Select all that apply.",
    options: ["Glucose", "Urea", "Amino acids", "Water"], answerIndices: [0, 2, 3],
    modelAnswer: "Glucose, amino acids and water",
    explanation: "Useful substances are reabsorbed; urea is a waste and stays in the urine.",
    quote: "Useful substances such as glucose, amino acids, salts and water are selectively reabsorbed in the tubule.",
  },
];

// student responses + scores for the two seeded attempts
const ATTEMPT_1: Record<string, [string, number, string, string?]> = {
  q1: ["0", 0, "You chose the stroma, but that is where the dark reaction happens. The light reaction is in the thylakoid membranes (grana).", "Confuses the sites of the light and dark reactions"],
  q2: ["When plants release oxygen at night", 0.2, "Partly off: photolysis is the splitting of water using light energy, producing hydrogen and oxygen. It happens in light, not at night.", "Does not link photolysis to splitting water"],
  q3: ["0", 0, "Oxygen and water are not used by the dark reaction. It uses ATP and NADPH made in the light reaction.", "Unclear on what links the two stages of photosynthesis"],
  q4: ["1", 1, "Correct. Guard cells that lose water go flaccid and the pore closes."],
  q5: ["It protects the stomach", 0.3, "Protecting the lining is the job of mucus. HCl makes the medium acidic for pepsin and kills germs.", "Mixes up the roles of HCl and mucus"],
  q6: ["1", 1, "Correct. Villi increase the surface area for absorption."],
  q7: ["0", 0, "Ethanol is produced by yeast. In muscles, pyruvate turns into lactic acid, which causes cramps.", "Confuses yeast fermentation with anaerobic respiration in muscle"],
  q8: ["In the cytoplasm, giving energy", 0.5, "Half right: energy is released, but pyruvate is broken down in the mitochondria, into carbon dioxide and water.", "Places the second stage in the wrong organelle"],
  q9: ["3", 1, "Correct. The left ventricle pumps oxygenated blood into the aorta."],
  q10: ["So the body gets oxygen efficiently", 0.8, "Good. Add that warm-blooded animals need this for constant body temperature."],
  q11: ["1", 0, "You picked only urea. Urea is the waste that stays in urine; glucose, amino acids and water are the ones reabsorbed.", "Thinks urea is reabsorbed"],
};
const ATTEMPT_2: Record<string, [string, number, string, string?]> = {
  q1: ["1", 1, "Correct. The light reaction occurs in the thylakoid membranes (grana)."],
  q2: ["Light splits water into hydrogen and oxygen", 0.8, "Good. Mention that the oxygen is released as a by-product."],
  q3: ["2", 0, "Glucose is the product of the dark reaction, not its input. It uses ATP and NADPH from the light reaction.", "Reverses inputs and outputs of the Calvin cycle"],
  q4: ["1", 1, "Correct."],
  q5: ["Makes the medium acidic for pepsin and kills germs", 0.9, "Correct and complete."],
  q6: ["1", 1, "Correct."],
  q7: ["1", 1, "Correct. Lactic acid causes the cramps."],
  q8: ["In the mitochondria into CO2 and water", 0.7, "Correct location and products. Add that oxygen is required and a large amount of energy is released."],
  q12: ["2", 1, "Correct."],
  q9: ["3", 1, "Correct."],
  q10: ["Efficient oxygen supply for warm-blooded animals", 0.9, "Correct."],
  q11: ["0,1", 0, "Glucose is right, but you again included urea, which cancels it out. Amino acids and water are also reabsorbed.", "Thinks urea is reabsorbed"],
};

function buildAttempt(
  id: string,
  createdAt: number,
  plan: Record<string, [string, number, string, string?]>,
  chunks: StudentData["chunks"],
  topicNames: Map<string, string>
): Attempt {
  const questions: QuizQuestion[] = [];
  const answers: Record<string, string> = {};
  const evaluations: Evaluation[] = [];
  for (const [key, [resp, score, feedback, misconception]] of Object.entries(plan)) {
    const s = POOL.find((p) => p.key === key)!;
    const chunk = chunks.find((c) => c.text.includes(s.quote)) ?? chunks[0];
    const qid = `${id}-${key}`;
    questions.push({
      id: qid,
      type: s.type,
      topicId: s.topicId,
      topicName: topicNames.get(s.topicId) ?? s.topicId,
      subtopic: s.subtopic,
      difficulty: s.difficulty ?? "easy",
      marks: s.marks ?? 1,
      question: s.question,
      options: s.options,
      answerIndex: s.answerIndex,
      answerIndices: s.answerIndices,
      rubric: s.rubric,
      modelAnswer: s.modelAnswer,
      explanation: s.explanation,
      citation: { chunkId: chunk.id, materialName: chunk.materialName, section: chunk.section, page: chunk.page, quote: s.quote },
    });
    answers[qid] = resp;
    const objective = s.type !== "short";
    evaluations.push({
      questionId: qid,
      score,
      correct: score >= 0.6,
      correctness: score >= 0.99 ? "correct" : score > 0 ? "partially_correct" : "incorrect",
      method: objective ? "deterministic" : "rubric_ai",
      feedback,
      misconception: score < 0.6 ? misconception : undefined,
      evidence: objective ? "Scored by answer key." : `Rubric: ${(s.rubric ?? []).join("; ")}`,
    });
  }
  return { id, createdAt, questions, answers, evaluations };
}

export function buildDemoData(now = Date.now()): StudentData {
  const DAY = 86_400_000;
  const mk = (id: string, name: string, kind: MaterialKind, pages: string[]): Material => ({
    id, name, kind, pages, createdAt: now - 6 * DAY, status: "ready", hash: fingerprint(pages), detectedKind: detectKind(pages.join("\n")),
    wordCount: pages.join(" ").split(/\s+/).length, headings: [], warnings: [],
  });
  const materials: Material[] = [
    mk("m_syl", "Syllabus - Life Processes", "syllabus", [SYLLABUS]),
    mk("m_notes", "Textbook Notes - Chapter 6", "notes", [NOTES_P1, NOTES_P2, NOTES_P3]),
    mk("m_pp", "Past Papers 2019-2024", "past_paper", [PAST_PAPER]),
  ];
  const chunks = materials.flatMap(chunkMaterial);
  materials.forEach((m) => (m.headings = Array.from(new Set(chunks.filter((c) => c.materialId === m.id).map((c) => c.section.split(" > ").pop()!))).filter((h) => h !== "General")));
  const retriever = new Retriever(chunks);
  let topics: Topic[] = TOPICS.map((t) => ({ ...t, examWeight: 0, sourceChunkIds: [] }));
  topics = attachTopicSources(topics, retriever);
  const pq = extractPastQuestionsDetailed(PAST_PAPER).map((q, i) => ({ id: `pq_${i + 1}`, text: q.text, marks: q.marks, materialName: materials[2].name }));
  const mapped = mapQuestionsToTopics(pq, topics, retriever);
  topics = mapped.topics;

  const names = new Map(topics.map((t) => [t.id, t.name]));
  const a1 = buildAttempt("att_1", now - 4 * DAY, ATTEMPT_1, chunks, names);
  const a2 = buildAttempt("att_2", now - 1 * DAY, ATTEMPT_2, chunks, names);

  const base: StudentData = {
    ...emptyData(),
    subject: "Biology - Life Processes (Class 10)",
    materials,
    chunks,
    topics,
    pastQuestions: mapped.pastQuestions,
  };
  const r1 = { ...buildGapReport({ ...base, attempts: [a1] }), createdAt: a1.createdAt + 60_000 };
  const r2 = { ...buildGapReport({ ...base, attempts: [a1, a2] }), createdAt: a2.createdAt + 60_000 };
  // demo-only: diagnosis text in the style the AI writes it, so the demo reads well without an API call
  const R2: Record<string, string> = {
    t_exc: "You've chosen “urea” as reabsorbed in both quizzes. In the nephron, useful substances (glucose, amino acids, salts, water) are reabsorbed and urea stays in the urine. This topic is in 2 past-paper questions, so fix it first.",
    t_nut: "Big improvement: you now place the light reaction correctly in the grana (was 1.2/4, now 2.8/4). The remaining gap is the dark reaction: you picked glucose as its input instead of ATP and NADPH. This is the most-examined topic (4 past-paper questions).",
    t_resp: "You fixed the lactic acid vs ethanol mix-up and now get alveoli right. Short answers on aerobic respiration still miss that oxygen is needed and lots of energy is released.",
    t_dig: "Strong now. You correctly separate the roles of HCl (acidic medium, kills germs) and mucus (protects the lining). Keep it fresh with a quick review.",
    t_trans: "Consistently strong: the heart's chambers and why double circulation matters are clear. Only a light review is needed.",
  };
  r2.topics = r2.topics.map((t) => ({ ...t, reason: R2[t.topicId] ?? t.reason }));
  r2.summary += " Your biggest gap is Excretion: a repeated misconception about what the nephron reabsorbs. Start there, then close the dark-reaction gap in Photosynthesis.";
  const run = (agent: AgentRun["agent"], at: number, ms: number, input: string, output: string): AgentRun => ({ id: `run_${agent}_${at}`, agent, at, ms, status: "ok", input, output });
  const agentRuns: AgentRun[] = [
    run("Document Ingestion", now - 6 * DAY, 41, "3 documents (5 pages)", `${chunks.length} chunks indexed, 0 duplicates, 0 warnings`),
    run("Syllabus Mapping", now - 6 * DAY + 5_000, 2310, "Syllabus - Life Processes", `${topics.length} topics, ${topics.reduce((s, t) => s + t.subtopics.length, 0)} subtopics`),
    run("Previous Paper Analysis", now - 6 * DAY + 6_000, 12, `${pq.length} past-paper questions`, `${mapped.pastQuestions.filter((q) => q.topicId).length} mapped, ${mapped.pastQuestions.filter((q) => q.needsReview).length} flagged for review`),
    run("Knowledge Retrieval", now - 4 * DAY, 3, "5 topics × top-3 sections", "15 chunks selected"),
    run("Diagnostic Question Generation", now - 4 * DAY + 1_000, 4120, "15 chunks, 11 questions requested", "11 accepted, 1 rejected (quote not in source)"),
    run("Answer Evaluation", now - 4 * DAY + 600_000, 2890, "11 answers", "7 deterministic, 4 rubric-scored"),
    run("Knowledge Gap Diagnosis", now - 4 * DAY + 603_000, 1980, "attempt 1", r1.summary),
    run("Revision Planning", now - 4 * DAY + 605_000, 2250, "5 days × 2 h", "plan built"),
    run("Answer Evaluation", now - DAY, 2610, "12 answers", "8 deterministic, 4 rubric-scored"),
    run("Knowledge Gap Diagnosis", now - DAY + 2_000, 1850, "attempts 1-2", r2.summary.split(".")[0]),
    run("Progress Monitoring", now - DAY + 3_000, 2, "attempt 2 vs 1", "Nutrition weak → medium; Excretion still weak (recurring misconception)"),
    run("Revision Planning", now - DAY + 4_000, 2140, "5 days × 2 h", "plan regenerated from new gap report"),
  ].reverse();
  const data: StudentData = { ...base, attempts: [a1, a2], reports: [r1, r2], agentRuns };
  data.plan = buildPlan(data, r2, data.planPrefs.days, data.planPrefs.hoursPerDay);
  return data;
}

export { citeLabel };
