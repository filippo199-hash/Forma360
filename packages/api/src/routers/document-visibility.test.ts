import { describe, expect, it } from 'vitest';
import {
  makeFolderVisibilityChecker,
  ownVisibilityPasses,
  type ViewerMemberships,
} from './document-visibility';

const viewer = (groups: string[], sites: string[]): ViewerMemberships => ({
  groupIds: new Set(groups),
  siteIds: new Set(sites),
});

describe('ownVisibilityPasses (To-Do #5)', () => {
  it('public when both arrays empty', () => {
    expect(ownVisibilityPasses([], [], viewer([], []))).toBe(true);
  });
  it('visible when viewer is in a listed group', () => {
    expect(ownVisibilityPasses(['g1'], [], viewer(['g1'], []))).toBe(true);
  });
  it('visible when viewer is in a listed site', () => {
    expect(ownVisibilityPasses([], ['s1'], viewer([], ['s1']))).toBe(true);
  });
  it('hidden when viewer is in none of the listed groups/sites', () => {
    expect(ownVisibilityPasses(['g1'], ['s1'], viewer(['g2'], ['s2']))).toBe(false);
  });
});

describe('makeFolderVisibilityChecker — ancestor cascade (To-Do #6)', () => {
  const folders = [
    { id: 'root', parentId: null, visibleToGroupIds: ['g1'], visibleToSiteIds: [] },
    // child is public on its own, but its parent restricts to g1
    { id: 'child', parentId: 'root', visibleToGroupIds: [], visibleToSiteIds: [] },
    { id: 'public', parentId: null, visibleToGroupIds: [], visibleToSiteIds: [] },
  ];

  it('parent restriction cascades down to an otherwise-public child', () => {
    const inG1 = makeFolderVisibilityChecker(folders, viewer(['g1'], []));
    const notInG1 = makeFolderVisibilityChecker(folders, viewer(['g2'], []));
    expect(inG1('child')).toBe(true);
    expect(notInG1('child')).toBe(false); // blocked by ancestor, even though child is public
    expect(notInG1('public')).toBe(true);
  });

  it('root (null) is always visible', () => {
    const check = makeFolderVisibilityChecker(folders, viewer([], []));
    expect(check(null)).toBe(true);
  });
});
