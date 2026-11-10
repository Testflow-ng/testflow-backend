import { connectDB, disconnectDB } from '../config/db.js';
import { Subject } from '../models/Subject.js';
import { Question } from '../models/Question.js';
import { logger } from '../utils/logger.js';

const ECO_SUBJECT = {
  code: 'ECO102',
  title: 'Principles of Economics',
  description: 'Introductory course covering basic economic principles, national income, and global interdependence.'
};

const ECO_QUESTIONS = [
  { stem: 'Which of the following best describes a functional relationship in economics?', options: ['A relationship in which all variables are constant', 'A relationship in which one variable depends on another', 'A relationship involving only independent variables', 'A relationship without mathematical expression'], correctIndex: 1, explanation: 'A functional relationship shows how one variable (dependent) changes in response to another (independent).' },
  { stem: 'In the equation Q = a - bP, the coefficient of price indicates that:', options: ['Demand increases by 4 units as price rises', 'Demand decreases by 4 units for every unit increase in price', 'Price decreases by 4 units', 'Demand remains constant'], correctIndex: 1, explanation: 'In a demand equation, the coefficient of price (b) represents the change in quantity demanded per unit change in price, usually showing an inverse relationship.' },
  { stem: 'A variable whose value is determined by another variable is known as:', options: ['Constant variable', 'Independent variable', 'Dependent variable', 'Dummy variable'], correctIndex: 2, explanation: 'A dependent variable is one whose value changes based on the value of another variable.' },
  { stem: 'An index number is primarily used to:', options: ['Measure the size of an economy', 'Compare changes in a variable over time', 'Determine exchange rates', 'Calculate unemployment'], correctIndex: 1, explanation: 'Index numbers measure relative changes in variables (like prices or quantity) over time.' },
  { stem: 'Which of the following is an example of an index number?', options: ['GDP', 'Consumer Price Index', 'National Income', 'Budget Deficit'], correctIndex: 1, explanation: 'CPI is a standard index number used to measure inflation.' },
  { stem: 'If two variables move in opposite directions, their relationship is:', options: ['Direct', 'Positive', 'Inverse', 'Constant'], correctIndex: 2, explanation: 'An inverse relationship occurs when one variable increases while the other decreases.' },
  { stem: 'The mathematical expression showing the relationship between income and consumption is called:', options: ['Production function', 'Consumption function', 'Demand schedule', 'Utility function'], correctIndex: 1, explanation: 'The consumption function expresses the relationship between total consumption and gross national income.' },
  { stem: 'Which of the following is most likely to be an independent variable in a demand function?', options: ['Quantity demanded', 'Price', 'Total revenue', 'Consumer surplus'], correctIndex: 1, explanation: 'In demand theory, price is the primary independent variable that determines the quantity demanded.' },
  { stem: 'National income refers to:', options: ['Government revenue only', 'The total value of goods imported', 'The total income earned by factors of production in an economy over a given period', 'The total money supply'], correctIndex: 2, explanation: 'National income is the total amount of money earned within a country by its factors of production.' },
  { stem: 'Which method is NOT used in measuring national income?', options: ['Income approach', 'Expenditure approach', 'Output approach', 'Inflation approach'], correctIndex: 3, explanation: 'The three standard methods are Income, Expenditure, and Output (Value Added).' },
  { stem: 'Gross Domestic Product measures:', options: ['Output produced by citizens anywhere in the world', 'Output produced within a country\'s borders', 'Government expenditure only', 'National savings'], correctIndex: 1, explanation: 'GDP is the total value of goods and services produced within a country\'s geographical borders.' },
  { stem: 'In the circular flow of income, households receive income mainly from:', options: ['Imports', 'Firms', 'Foreign governments', 'Banks'], correctIndex: 1, explanation: 'Firms pay households for factor services (land, labor, capital, entrepreneurship).' },
  { stem: 'Which of the following is classified as an injection into the circular flow of income?', options: ['Savings', 'Imports', 'Investment', 'Taxation'], correctIndex: 2, explanation: 'Injections include Investment (I), Government Spending (G), and Exports (X).' },
  { stem: 'Which of the following is a withdrawal from the circular flow of income?', options: ['Government expenditure', 'Investment', 'Exports', 'Savings'], correctIndex: 3, explanation: 'Withdrawals (leakages) include Savings (S), Taxation (T), and Imports (M).' },
  { stem: 'Double counting in national income accounting occurs when:', options: ['Final goods are excluded', 'Intermediate goods are counted more than once', 'Imports are ignored', 'Exports exceed imports'], correctIndex: 1, explanation: 'Double counting occurs if the value of intermediate goods is added to the value of final goods.' },
  { stem: 'Which of the following is most likely to cause difficulty in measuring Nigeria\'s national income?', options: ['Industrialization', 'Informal sector activities', 'High literacy rate', 'Stable prices'], correctIndex: 1, explanation: 'Large informal sectors with unrecorded transactions make accurate national income calculation difficult.' },
  { stem: 'Equilibrium national income is attained when:', options: ['Aggregate demand exceeds aggregate supply', 'Aggregate demand equals aggregate supply', 'Savings exceed investment', 'Imports equal exports'], correctIndex: 1, explanation: 'Equilibrium occurs where Aggregate Demand (AD) equals Aggregate Supply (AS).' },
  { stem: 'The Keynesian multiplier explains the relationship between:', options: ['Taxation and inflation', 'Initial investment and total increase in income', 'Imports and exports', 'Exchange rate and inflation'], correctIndex: 1, explanation: 'The multiplier shows how an initial change in spending leads to a larger final change in national income.' },
  { stem: 'Autonomous consumption refers to consumption:', options: ['Financed only by borrowing', 'That occurs even when income is zero', 'Equal to disposable income', 'Financed by taxation'], correctIndex: 1, explanation: 'Autonomous consumption is the level of spending that does not depend on income.' },
  { stem: 'Which factor is most likely to increase aggregate demand?', options: ['Reduction in investment', 'Increase in consumer spending', 'Increase in unemployment', 'Reduction in government expenditure'], correctIndex: 1, explanation: 'Increased consumer spending is a component of AD (AD = C + I + G + (X-M)).' },
  { stem: 'If planned savings exceed planned investment, national income will tend to:', options: ['Rise', 'Fall', 'Remain unchanged', 'Double'], correctIndex: 1, explanation: 'If savings (withdrawal) exceed investment (injection), there is a net leakage causing income to fall.' },
  { stem: 'The main objective of income determination analysis is to explain:', options: ['Exchange rates', 'Price discrimination', 'The level of national output and employment', 'International trade'], correctIndex: 2, explanation: 'Income determination focuses on what determines the level of output and employment in an economy.' },
  { stem: 'Which of the following would most likely shift the aggregate demand curve to the right?', options: ['Increase in taxes', 'Increase in investment spending', 'Decrease in exports', 'Reduction in government expenditure'], correctIndex: 1, explanation: 'Increased investment spending shifts AD to the right.' },
  { stem: 'Consumption is best defined as:', options: ['Production of goods', 'Spending on goods and services for satisfaction', 'Saving part of income', 'Payment of taxes'], correctIndex: 1, explanation: 'Consumption is the act of using up goods and services to satisfy human wants.' },
  { stem: 'Which of the following generally increases household savings?', options: ['Lower disposable income', 'Higher disposable income', 'Higher inflation only', 'Increase in imports'], correctIndex: 1, explanation: 'Savings typically rise as disposable income increases.' },
  { stem: 'Investment expenditure refers to:', options: ['Purchase of shares only', 'Purchase of capital goods', 'Payment of salaries', 'Household consumption'], correctIndex: 1, explanation: 'Economic investment refers to the creation of new capital assets (machinery, buildings, etc.).' },
  { stem: 'A progressive tax is one in which:', options: ['Everyone pays the same amount', 'The tax rate increases as income increases', 'The tax rate decreases with income', 'Only companies pay tax'], correctIndex: 1, explanation: 'A progressive tax takes a larger percentage of income from high-income earners than from low-income earners.' },
  { stem: 'Government expenditure is classified as:', options: ['Injection into the economy', 'Withdrawal from the economy', 'Transfer payment only', 'Household income'], correctIndex: 0, explanation: 'Government spending is an injection into the circular flow of income.' },
  { stem: 'Which of the following is NOT a function of money?', options: ['Medium of exchange', 'Store of value', 'Unit of account', 'Barrier to trade'], correctIndex: 3, explanation: 'Money facilitates trade; it is not a barrier.' },
  { stem: 'The institution responsible for issuing currency in Nigeria is the:', options: ['Ministry of Finance', 'Central Bank of Nigeria', 'Nigerian Exchange Group', 'Federal Inland Revenue Service'], correctIndex: 1, explanation: 'The CBN has the sole right to issue currency in Nigeria.' },
  { stem: 'Commercial banks primarily create money through:', options: ['Tax collection', 'Lending activities', 'Printing currency', 'Foreign aid'], correctIndex: 1, explanation: 'Banks create money through the process of fractional reserve banking and lending.' },
  { stem: 'Demand-pull inflation occurs when:', options: ['Aggregate demand persistently exceeds aggregate supply', 'Production costs fall', 'Imports exceed exports', 'Interest rates fall automatically'], correctIndex: 0, explanation: 'Demand-pull inflation happens when "too much money chases too few goods."' },
  { stem: 'Which of the following is an economic consequence of persistent unemployment?', options: ['Higher national output', 'Waste of productive resources', 'Lower poverty', 'Stable prices'], correctIndex: 1, explanation: 'Unemployment represents a waste of human capital/productive resources.' },
  { stem: 'Cost-push inflation is mainly associated with:', options: ['Increase in production costs', 'Increase in exports', 'Reduction in taxes', 'Increase in savings'], correctIndex: 0, explanation: 'Cost-push inflation occurs when production costs (like wages or raw materials) rise.' },
  { stem: 'Which government policy is most appropriate for reducing inflation?', options: ['Expansionary fiscal policy', 'Contractionary monetary policy', 'Reduction in interest rates', 'Increase in government spending'], correctIndex: 1, explanation: 'Contractionary monetary policy (e.g., higher interest rates) helps cool down an overheating economy.' },
  { stem: 'Aggregate supply refers to:', options: ['Total quantity of goods and services producers are willing to supply at different price levels', 'Total imports into a country', 'Household demand', 'Total exports'], correctIndex: 0, explanation: 'AS is the total output of an economy at a given price level.' },
  { stem: 'The exchange rate is:', options: ['The price of one currency in terms of another', 'The rate of inflation', 'The interest charged by banks', 'The tax on imports'], correctIndex: 0, explanation: 'Exchange rate is the value of one currency for the purpose of conversion to another.' },
  { stem: 'The Balance of Payments records:', options: ['Only exports', 'All economic transactions between residents of a country and the rest of the world', 'Government expenditure only', 'National income'], correctIndex: 1, explanation: 'BOP is a systematic record of all economic transactions between residents and the rest of the world.' },
  { stem: 'A persistent Balance of Payments deficit may result in:', options: ['Appreciation of the domestic currency', 'Pressure on foreign exchange reserves', 'Lower demand for imports', 'Increase in exports automatically'], correctIndex: 1, explanation: 'A deficit means more money is leaving the country than entering, depleting reserves.' },
  { stem: 'Global interdependence implies that:', options: ['Countries can exist without trading', 'Economic events in one country may affect other countries', 'Imports are unnecessary', 'Exchange rates remain permanently fixed'], correctIndex: 1, explanation: 'Interdependence means economies are linked; a crisis in one can spread to others.' }
];

const run = async () => {
  await connectDB();

  // 1. Ensure the subject exists
  const subject = await Subject.findOneAndUpdate(
    { code: ECO_SUBJECT.code },
    { $setOnInsert: ECO_SUBJECT },
    { upsert: true, new: true }
  );
  logger.info(`Ensured subject exists: ${subject.code}`);

  // 2. Insert questions
  let inserted = 0;
  let skipped = 0;

  for (const qData of ECO_QUESTIONS) {
    const exists = await Question.findOne({ subject: subject._id, stem: qData.stem });
    if (exists) {
      skipped++;
      continue;
    }

    await Question.create({
      ...qData,
      subject: subject._id,
      difficulty: qData.difficulty || 'medium'
    });
    inserted++;
  }

  logger.info(`ECO102 Seeding complete: ${inserted} inserted, ${skipped} skipped.`);

  await disconnectDB();
  process.exit(0);
};

run().catch(async (error) => {
  logger.error('ECO102 Seed failed', error);
  await disconnectDB().catch(() => {});
  process.exit(1);
});
