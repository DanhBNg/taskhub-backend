const {
  normalizeSuggestedActions,
  parseJsonFromText,
  normalizeAssistantResponse,
  normalizeGeneratedTasks,
  normalizeTaskInsights,
} = require('../assistantUtils');

describe('assistant utils', () => {
  test('filters invalid and duplicated suggested actions', () => {
    expect(
      normalizeSuggestedActions([
        'summarize',
        'CREATE_TASK',
        'UNKNOWN',
        'summarize',
        '',
      ]),
    ).toEqual(['SUMMARIZE', 'CREATE_TASK']);
  });

  test('parses JSON object wrapped in markdown text', () => {
    const raw = '```json\n{"reply":"OK","suggestedActions":["FIND_TASK"]}\n```';

    expect(parseJsonFromText(raw, {})).toEqual({
      reply: 'OK',
      suggestedActions: ['FIND_TASK'],
    });
  });

  test('normalizes assistant response and drops unsupported actions', () => {
    const raw = JSON.stringify({
      reply: '  Xin chao  ',
      suggestedActions: ['PRIORITIZE', 'DELETE_PROJECT'],
    });

    expect(normalizeAssistantResponse(raw)).toEqual({
      reply: 'Xin chao',
      suggestedActions: ['PRIORITIZE'],
    });
  });

  test('normalizes generated tasks and defaults invalid priority', () => {
    const tasks = normalizeGeneratedTasks([
      { title: '  Task 1 ', description: 'Mo ta', priority: 'Urgent' },
      { title: '', description: 'Bi loai', priority: 'High' },
    ]);

    expect(tasks).toEqual([
      { title: 'Task 1', description: 'Mo ta', priority: 'Medium' },
    ]);
  });

  test('limits generated tasks to five items', () => {
    const rawTasks = Array.from({ length: 7 }, (_, index) => ({
      title: `Task ${index + 1}`,
      priority: 'Low',
    }));

    expect(normalizeGeneratedTasks(rawTasks)).toHaveLength(5);
  });

  test('normalizes task insights and limits to eight items', () => {
    const rawTasks = Array.from({ length: 10 }, (_, index) => ({
      taskName: `Task ${index + 1}`,
      matchReason: 'Phu hop',
    }));

    const tasks = normalizeTaskInsights(rawTasks);

    expect(tasks).toHaveLength(8);
    expect(tasks[0]).toMatchObject({
      title: 'Task 1',
      reason: 'Phu hop',
      rank: 1,
    });
  });
});
