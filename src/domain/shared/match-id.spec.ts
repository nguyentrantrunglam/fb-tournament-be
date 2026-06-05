import { matchId, groupMatchId, rrMatchId } from './match-id';

describe('matchId', () => {
  it('formats single-elim match id', () => {
    expect(matchId('MS', 1, 0)).toBe('MS-R1-0');
    expect(matchId('MS', 2, 3)).toBe('MS-R2-3');
    expect(matchId('WD', 3, 7)).toBe('WD-R3-7');
  });
});

describe('groupMatchId', () => {
  it('formats group match id', () => {
    expect(groupMatchId('MS', 'A', 0)).toBe('MS-GA-M0');
    expect(groupMatchId('XD', 'B', 5)).toBe('XD-GB-M5');
  });
});

describe('rrMatchId', () => {
  it('formats round-robin match id', () => {
    expect(rrMatchId('MS', 0)).toBe('MS-RR-0');
    expect(rrMatchId('WD', 9)).toBe('WD-RR-9');
  });
});
