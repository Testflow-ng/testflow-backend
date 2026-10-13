import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { computeScore, rankParticipants } from '../src/utils/liveRank.js';
import { generateShareCode } from '../src/utils/liveCode.js';

const question = (selectedOption, correctOption = 0) => ({
  selectedOption,
  correctOption,
});

describe('Live CBT scoring', () => {
  it('scores correct/incorrect/unanswered with negative marking', () => {
    const result = computeScore({
      questions: [question(0), question(1), question(null), question(0)],
      marksPerQuestion: 1,
      negativeMarking: 0.25,
    });
    assert.equal(result.correctCount, 2);
    assert.equal(result.incorrectCount, 1);
    assert.equal(result.unansweredCount, 1);
    assert.equal(result.score, 1.75);
    assert.equal(result.accuracy, 50);
    assert.equal(result.totalPossible, 4);
  });

  it('never penalizes unanswered questions', () => {
    const result = computeScore({
      questions: [question(null), question(null)],
      marksPerQuestion: 2,
      negativeMarking: 1,
    });
    assert.equal(result.score, 0);
    assert.equal(result.accuracy, 0);
  });

  it('computes accuracy against total scorable questions', () => {
    const result = computeScore({ questions: [question(0), question(null)], marksPerQuestion: 1, negativeMarking: 0 });
    assert.equal(result.accuracy, 50);
  });
});

describe('Live CBT ranking', () => {
  it('ranks the worked example: score > accuracy > time', () => {
    // 20-question exam: A/B 20 correct, C/D 18, E 15.
    const ranked = rankParticipants([
      { key: 'A', score: 20, accuracy: 100, timeTakenSeconds: 480, sequenceNumber: 1 },
      { key: 'B', score: 20, accuracy: 100, timeTakenSeconds: 600, sequenceNumber: 2 },
      { key: 'C', score: 18, accuracy: 90, timeTakenSeconds: 420, sequenceNumber: 3 },
      { key: 'D', score: 18, accuracy: 90, timeTakenSeconds: 540, sequenceNumber: 4 },
      { key: 'E', score: 15, accuracy: 75, timeTakenSeconds: 360, sequenceNumber: 5 },
    ]);
    assert.deepEqual(ranked.map((r) => r.key), ['A', 'B', 'C', 'D', 'E']);
    assert.deepEqual(ranked.map((r) => r.rank), [1, 2, 3, 4, 5]);
  });

  it('never ties: identical metrics fall back to sequence number', () => {
    const ranked = rankParticipants(
      Array.from({ length: 50 }, (_, i) => ({
        key: `p${i}`,
        score: 10,
        accuracy: 50,
        timeTakenSeconds: 600,
        sequenceNumber: 50 - i,
      })),
    );
    const ranks = ranked.map((r) => r.rank);
    assert.equal(new Set(ranks).size, 50);
    assert.deepEqual(ranks, Array.from({ length: 50 }, (_, i) => i + 1));
    // Lowest sequence number first among full ties.
    assert.equal(ranked[0].sequenceNumber, 1);
    assert.equal(ranked[49].sequenceNumber, 50);
  });

  it('is stable across repeated calculations', () => {
    const entries = Array.from({ length: 100 }, (_, i) => ({
      key: `p${i}`,
      score: i % 7,
      accuracy: (i * 13) % 100,
      timeTakenSeconds: 300 + ((i * 37) % 900),
      sequenceNumber: i + 1,
    }));
    const first = rankParticipants(entries).map((r) => `${r.key}:${r.rank}`);
    const second = rankParticipants([...entries].reverse()).map((r) => `${r.key}:${r.rank}`);
    assert.deepEqual([...first].sort(), [...second].sort());
  });

  it('sorts unfinished attempts last without crashing', () => {
    const ranked = rankParticipants([
      { key: 'done', score: 5, accuracy: 50, timeTakenSeconds: 600, sequenceNumber: 2 },
      { key: 'pending', score: 5, accuracy: 50, timeTakenSeconds: undefined, sequenceNumber: 1 },
    ]);
    assert.equal(ranked[0].key, 'done');
  });
});

describe('Live CBT share codes', () => {
  it('generates unique URL-safe codes without ambiguous characters', () => {
    const codes = new Set(Array.from({ length: 1000 }, () => generateShareCode()));
    assert.equal(codes.size, 1000);
    for (const code of codes) {
      assert.match(code, /^[A-Za-z2-9]{9}$/);
      assert.ok(!/[01lO]/.test(code));
    }
  });
});

describe('Live CBT realtime rooms (WebSocket fan-out)', () => {
  it('isolates events per exam room and drops dead sockets', async () => {
    const { publish, registerWs, unregisterWs, subscriberCount } = await import(
      '../src/services/liveEvents.js'
    );
    const sentA = [];
    const sentB = [];
    const socketA = { readyState: 1, send: (msg) => sentA.push(JSON.parse(msg)) };
    const socketB = { readyState: 1, send: (msg) => sentB.push(JSON.parse(msg)) };
    const dead = { readyState: 3, send: () => { throw new Error('closed'); } };

    registerWs('ROOMAAAAA', socketA);
    registerWs('ROOMAAAAA', dead);
    registerWs('ROOMB3333', socketB);
    assert.equal(subscriberCount('ROOMAAAAA'), 2);

    const delivered = publish('ROOMAAAAA', 'exam.started', { hello: 1 });
    assert.equal(delivered, 1);
    assert.equal(sentA.length, 1);
    assert.equal(sentA[0].event, 'exam.started');
    assert.ok(sentA[0].serverTime);
    assert.equal(sentB.length, 0);
    // Dead socket pruned; only the live one remains.
    assert.equal(subscriberCount('ROOMAAAAA'), 1);

    unregisterWs('ROOMAAAAA', socketA);
    unregisterWs('ROOMB3333', socketB);
    assert.equal(subscriberCount('ROOMAAAAA'), 0);
  });

  it('caps rooms at 30 participants', async () => {
    const { createLiveExamSchema } = await import('../src/validators/liveCbt.schema.js');
    const over = createLiveExamSchema.safeParse({
      body: { title: 'Big exam here', subject: 'MTH101', numQuestions: 10, durationMinutes: 30, maxParticipants: 31 },
    });
    assert.equal(over.success, false);
    const ok = createLiveExamSchema.safeParse({
      body: { title: 'Small exam here', subject: 'MTH101', numQuestions: 10, durationMinutes: 30, maxParticipants: 30 },
    });
    assert.equal(ok.success, true);
  });
});
