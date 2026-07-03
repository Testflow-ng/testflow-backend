import { connectDB, disconnectDB } from '../config/db.js';
import { Subject } from '../models/Subject.js';
import { Question } from '../models/Question.js';
import { logger } from '../utils/logger.js';

// The fixed course list. Titles are sensible defaults an admin can edit later.
const SUBJECTS = [
  { code: 'PHY102', title: 'General Physics II' },
  { code: 'ACC102', title: 'Principles of Accounting II' },
  { code: 'MTH102', title: 'Elementary Mathematics II' },
  { code: 'EGL102', title: 'Use of English II' },
  { code: 'PHL102', title: 'Introduction to Logic and Philosophy' },
  { code: 'CHM102', title: 'General Chemistry II' },
  { code: 'STA112', title: 'Probability and Statistics I' },
  { code: 'GST112', title: 'Nigerian Peoples and Culture' },
];

// Sample practice questions per subject. The exam engine shuffles option order
// per attempt, so the stored answer position is not exposed to students.
const QUESTIONS = {
  PHY102: [
    { stem: 'What is the SI unit of electric charge?', options: ['Coulomb', 'Ampere', 'Volt', 'Ohm'], correctIndex: 0, explanation: 'The coulomb (C) is the SI unit of charge. The ampere measures charge flow per second.' },
    { stem: 'Ohm’s law relates voltage (V), current (I) and resistance (R) as:', options: ['V = IR', 'V = I/R', 'V = R/I', 'I = VR'], correctIndex: 0, explanation: 'Ohm’s law states V = IR.' },
    { stem: 'What is the SI unit of capacitance?', options: ['Farad', 'Henry', 'Tesla', 'Weber'], correctIndex: 0, explanation: 'Capacitance is measured in farads (F).' },
    { stem: 'The speed of light in a vacuum is approximately:', options: ['3 × 10^8 m/s', '3 × 10^6 m/s', '1.5 × 10^8 m/s', '3 × 10^10 m/s'], correctIndex: 0, explanation: 'Light travels at about 3 × 10^8 metres per second in a vacuum.' },
    { stem: 'Which subatomic particle carries a negative charge?', options: ['Electron', 'Proton', 'Neutron', 'Photon'], correctIndex: 0, explanation: 'Electrons are negatively charged; protons are positive and neutrons are neutral.' },
    { stem: 'The bending of light as it passes from one medium into another is called:', options: ['Refraction', 'Reflection', 'Diffraction', 'Dispersion'], correctIndex: 0, explanation: 'Refraction is the change in direction of light due to a change in speed between media.' },
  ],
  ACC102: [
    { stem: 'The basic accounting equation is:', options: ['Assets = Liabilities + Equity', 'Assets = Liabilities − Equity', 'Assets + Liabilities = Equity', 'Equity = Assets + Liabilities'], correctIndex: 0, explanation: 'Assets are financed by liabilities and owner’s equity.' },
    { stem: 'Which statement shows a firm’s financial position at a specific point in time?', options: ['Balance sheet', 'Income statement', 'Cash flow statement', 'Trial balance'], correctIndex: 0, explanation: 'The balance sheet reports assets, liabilities and equity at a point in time.' },
    { stem: 'Depreciation is best described as:', options: ['Spreading an asset’s cost over its useful life', 'An increase in an asset’s market value', 'The immediate expensing of an asset', 'Cash paid to buy an asset'], correctIndex: 0, explanation: 'Depreciation allocates the cost of a long-lived asset over the periods it benefits.' },
    { stem: 'In double-entry bookkeeping, each transaction affects at least how many accounts?', options: ['Two', 'One', 'Three', 'Four'], correctIndex: 0, explanation: 'Every transaction has equal debit and credit entries affecting at least two accounts.' },
    { stem: 'Which of the following is a current asset?', options: ['Inventory', 'Land', 'Building', 'Goodwill'], correctIndex: 0, explanation: 'Inventory is expected to convert to cash within a year, making it a current asset.' },
    { stem: 'A credit entry increases which type of account?', options: ['Liabilities', 'Assets', 'Expenses', 'Drawings'], correctIndex: 0, explanation: 'Credits increase liabilities, equity and revenue; debits increase assets and expenses.' },
  ],
  MTH102: [
    { stem: 'What is the derivative of x² with respect to x?', options: ['2x', 'x', 'x²/2', '2'], correctIndex: 0, explanation: 'By the power rule, d/dx(x²) = 2x.' },
    { stem: 'Evaluate ∫ 1 dx.', options: ['x + C', '1 + C', '0', 'x²/2'], correctIndex: 0, explanation: 'The integral of 1 with respect to x is x + C.' },
    { stem: 'What is the value of log₁₀(1000)?', options: ['3', '2', '10', '100'], correctIndex: 0, explanation: 'Since 10³ = 1000, log₁₀(1000) = 3.' },
    { stem: 'Solve for x: 2x + 6 = 14.', options: ['4', '10', '3', '7'], correctIndex: 0, explanation: '2x = 8, so x = 4.' },
    { stem: 'What is the derivative of sin(x)?', options: ['cos(x)', '−cos(x)', '−sin(x)', 'tan(x)'], correctIndex: 0, explanation: 'd/dx(sin x) = cos x.' },
    { stem: 'What is the value of 5! (five factorial)?', options: ['120', '25', '60', '720'], correctIndex: 0, explanation: '5! = 5 × 4 × 3 × 2 × 1 = 120.' },
  ],
  EGL102: [
    { stem: 'Choose the correctly spelled word:', options: ['Definitely', 'Definately', 'Definatly', 'Defenitely'], correctIndex: 0, explanation: 'The correct spelling is “definitely”.' },
    { stem: 'What is the plural of “child”?', options: ['Children', 'Childs', 'Childes', 'Childrens'], correctIndex: 0, explanation: '“Child” has an irregular plural: “children”.' },
    { stem: 'Which word is a synonym of “happy”?', options: ['Joyful', 'Sad', 'Angry', 'Weary'], correctIndex: 0, explanation: '“Joyful” means feeling or showing happiness.' },
    { stem: 'Identify the verb in the sentence: “She sings beautifully.”', options: ['sings', 'She', 'beautifully', 'sentence'], correctIndex: 0, explanation: '“Sings” is the action word (verb); “beautifully” is an adverb.' },
    { stem: 'Choose the grammatically correct sentence:', options: ['He doesn’t like tea.', 'He don’t like tea.', 'He not like tea.', 'He didn’t likes tea.'], correctIndex: 0, explanation: 'With third-person singular “he”, the correct form is “doesn’t like”.' },
    { stem: 'Which word is an antonym of “ancient”?', options: ['Modern', 'Historic', 'Aged', 'Antique'], correctIndex: 0, explanation: '“Modern” (recent) is the opposite of “ancient” (very old).' },
  ],
  PHL102: [
    { stem: 'In logic, a statement that is either true or false is called a:', options: ['Proposition', 'Question', 'Command', 'Exclamation'], correctIndex: 0, explanation: 'A proposition is a declarative statement with a truth value.' },
    { stem: '“All men are mortal; Socrates is a man; therefore Socrates is mortal” is an example of a:', options: ['Syllogism', 'Paradox', 'Analogy', 'Metaphor'], correctIndex: 0, explanation: 'This is a categorical syllogism: a conclusion drawn from two premises.' },
    { stem: 'The branch of philosophy that studies correct reasoning is:', options: ['Logic', 'Ethics', 'Metaphysics', 'Aesthetics'], correctIndex: 0, explanation: 'Logic is the study of valid inference and reasoning.' },
    { stem: 'Attacking the person making an argument rather than the argument itself is the fallacy of:', options: ['Ad hominem', 'Straw man', 'False dilemma', 'Circular reasoning'], correctIndex: 0, explanation: '“Ad hominem” targets the person instead of addressing their argument.' },
    { stem: '“If P then Q” is known in logic as a:', options: ['Conditional statement', 'Conjunction', 'Disjunction', 'Negation'], correctIndex: 0, explanation: '“If P then Q” is a conditional (implication).' },
    { stem: 'The branch of philosophy concerned with the nature of knowledge is:', options: ['Epistemology', 'Ethics', 'Logic', 'Aesthetics'], correctIndex: 0, explanation: 'Epistemology studies the nature, sources and limits of knowledge.' },
  ],
  CHM102: [
    { stem: 'What is the chemical symbol for sodium?', options: ['Na', 'So', 'Sd', 'S'], correctIndex: 0, explanation: 'Sodium’s symbol is “Na”, from the Latin “natrium”.' },
    { stem: 'At 25°C, the pH of a neutral aqueous solution is:', options: ['7', '0', '14', '1'], correctIndex: 0, explanation: 'A neutral solution has a pH of 7 at 25°C.' },
    { stem: 'Water is composed of hydrogen and which other element?', options: ['Oxygen', 'Nitrogen', 'Carbon', 'Chlorine'], correctIndex: 0, explanation: 'Water (H₂O) is made of hydrogen and oxygen.' },
    { stem: 'The atomic number of an element is equal to its number of:', options: ['Protons', 'Neutrons', 'Electrons and neutrons', 'Neutrons and protons'], correctIndex: 0, explanation: 'Atomic number = number of protons in the nucleus.' },
    { stem: 'Which gas is the most abundant in the Earth’s atmosphere?', options: ['Nitrogen', 'Oxygen', 'Carbon dioxide', 'Hydrogen'], correctIndex: 0, explanation: 'Nitrogen makes up about 78% of the atmosphere.' },
    { stem: 'A substance that speeds up a chemical reaction without being consumed is a:', options: ['Catalyst', 'Reactant', 'Product', 'Solvent'], correctIndex: 0, explanation: 'A catalyst increases reaction rate and is regenerated, not consumed.' },
  ],
  STA112: [
    { stem: 'The probability of an event that is certain to occur is:', options: ['1', '0', '0.5', '100'], correctIndex: 0, explanation: 'A certain event has probability 1.' },
    { stem: 'The measure of central tendency that is the middle value of an ordered data set is the:', options: ['Median', 'Mean', 'Mode', 'Range'], correctIndex: 0, explanation: 'The median is the middle value when data are ordered.' },
    { stem: 'The value that occurs most frequently in a data set is the:', options: ['Mode', 'Mean', 'Median', 'Variance'], correctIndex: 0, explanation: 'The mode is the most frequently occurring value.' },
    { stem: 'When a fair coin is tossed once, the probability of getting a head is:', options: ['1/2', '1', '1/4', '0'], correctIndex: 0, explanation: 'A fair coin has two equally likely outcomes, so P(head) = 1/2.' },
    { stem: 'The square root of the variance is called the:', options: ['Standard deviation', 'Mean', 'Range', 'Median'], correctIndex: 0, explanation: 'Standard deviation is the square root of the variance.' },
    { stem: 'The sum of all probabilities in a probability distribution is:', options: ['1', '0', '100', 'Equal to the number of outcomes'], correctIndex: 0, explanation: 'Probabilities in a distribution sum to 1.' },
  ],
  GST112: [
    { stem: 'In what year did Nigeria gain independence?', options: ['1960', '1963', '1957', '1970'], correctIndex: 0, explanation: 'Nigeria gained independence from Britain on 1 October 1960.' },
    { stem: 'How many geopolitical zones does Nigeria have?', options: ['Six', 'Four', 'Three', 'Nine'], correctIndex: 0, explanation: 'Nigeria is divided into six geopolitical zones.' },
    { stem: 'Which of the following is one of Nigeria’s three largest ethnic groups?', options: ['Yoruba', 'Zulu', 'Akan', 'Swahili'], correctIndex: 0, explanation: 'The three largest groups are Hausa-Fulani, Yoruba and Igbo.' },
    { stem: 'What is the capital city of Nigeria?', options: ['Abuja', 'Lagos', 'Kano', 'Ibadan'], correctIndex: 0, explanation: 'Abuja became Nigeria’s capital in 1991, replacing Lagos.' },
    { stem: 'The River Niger and the River Benue meet (confluence) at which city?', options: ['Lokoja', 'Onitsha', 'Jos', 'Enugu'], correctIndex: 0, explanation: 'The Niger and Benue rivers meet at Lokoja, Kogi State.' },
    { stem: 'In what year did Nigeria become a republic?', options: ['1963', '1960', '1979', '1999'], correctIndex: 0, explanation: 'Nigeria became a republic on 1 October 1963.' },
  ],
};

const run = async () => {
  await connectDB();

  // Subjects: insert missing, never overwrite admin-edited titles.
  for (const subject of SUBJECTS) {
    await Subject.updateOne({ code: subject.code }, { $setOnInsert: subject }, { upsert: true });
  }
  logger.info(`Seeded ${SUBJECTS.length} subjects.`);

  // Questions: insert missing (idempotent by subject + stem); full validation runs on create.
  let inserted = 0;
  let skipped = 0;
  for (const [code, questions] of Object.entries(QUESTIONS)) {
    const subject = await Subject.findOne({ code });
    if (!subject) {
      logger.warn(`Subject ${code} not found; skipping its questions.`);
      continue;
    }
    for (const question of questions) {
      const exists = await Question.findOne({ subject: subject._id, stem: question.stem });
      if (exists) {
        skipped += 1;
        continue;
      }
      await Question.create({
        subject: subject._id,
        stem: question.stem,
        options: question.options,
        correctIndex: question.correctIndex,
        explanation: question.explanation,
        difficulty: question.difficulty ?? 'medium',
      });
      inserted += 1;
    }
  }
  logger.info(`Questions seeded: ${inserted} inserted, ${skipped} already present.`);

  await disconnectDB();
  process.exit(0);
};

run().catch(async (error) => {
  logger.error('Seed failed', error);
  await disconnectDB().catch(() => {});
  process.exit(1);
});
