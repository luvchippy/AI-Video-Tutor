import { describe, it, expect } from 'vitest';
import { readCreatorMeta, type CreatorMetaValue } from './creator-meta';
import {
  collectCreatorMeta as collectYouTubeMeta,
  pickCreator as pickYouTubeCreator,
} from './youtube';
import {
  collectCreatorMeta as collectBilibiliMeta,
  pickCreator as pickBilibiliCreator,
} from './bilibili';

/** A reader backed by a plain object, standing in for the DOM in a test. */
function readerFor(
  values: Record<string, CreatorMetaValue>,
): (selector: string) => CreatorMetaValue | undefined {
  return (selector) => values[selector];
}

const SELECTOR_NEVER_PRESENT = '#nothing-matches-this';

describe('readCreatorMeta', () => {
  it('gives name keys the content attribute and falls back to text', () => {
    const meta = readCreatorMeta(['meta[name=author]', 'a.up-name'], [], (selector) =>
      selector === 'meta[name=author]'
        ? { content: 'From content' }
        : { text: 'From text' },
    );

    expect(meta).toEqual({
      'meta[name=author]': 'From content',
      'a.up-name': 'From text',
    });
  });

  it('gives url keys the href only, never content or text', () => {
    const meta = readCreatorMeta([], ['a[href]'], () => ({
      content: 'ignored',
      text: 'ignored',
      href: '/channel/1',
    }));

    expect(meta).toEqual({ 'a[href]': '/channel/1' });
  });

  it('keeps a key that matched nothing, with an undefined value', () => {
    const meta = readCreatorMeta(['a'], ['b'], () => undefined);

    expect(Object.keys(meta)).toEqual(['a', 'b']);
    expect(meta['a']).toBeUndefined();
    expect(meta['b']).toBeUndefined();
  });
});

describe('collectCreatorMeta + pickCreator (YouTube)', () => {
  it('reads the channel name and url out of the author microdata', () => {
    const creator = pickYouTubeCreator(
      collectYouTubeMeta(
        readerFor({
          '[itemprop=author] [itemprop=name]': { content: 'Veritasium' },
          '[itemprop=author] [itemprop=url]': { href: '/@veritasium' },
        }),
      ),
    );

    expect(creator).toEqual({
      name: 'Veritasium',
      url: 'https://www.youtube.com/@veritasium',
    });
  });

  it('prefers the channel-name element over the head metadata', () => {
    const creator = pickYouTubeCreator(
      collectYouTubeMeta(
        readerFor({
          '[itemprop=author] [itemprop=name]': { text: 'From the player block' },
          'meta[name=author]': { content: 'From the head' },
        }),
      ),
    );

    expect(creator?.name).toBe('From the player block');
  });

  it('falls back to meta[name=author] when the player block is absent', () => {
    const creator = pickYouTubeCreator(
      collectYouTubeMeta(
        readerFor({ 'meta[name=author]': { content: 'Channel From Head' } }),
      ),
    );

    expect(creator).toEqual({ name: 'Channel From Head', url: null });
  });

  it('never reads the bare [itemprop=name] selector, which is the video title', () => {
    const meta = collectYouTubeMeta(
      readerFor({ '[itemprop=name]': { content: 'The video title' } }),
    );

    expect(meta[SELECTOR_NEVER_PRESENT]).toBeUndefined();
    expect(Object.values(meta)).not.toContain('The video title');
    expect(pickYouTubeCreator(meta)).toBeNull();
  });

  it('returns null when the page exposes no channel name', () => {
    expect(pickYouTubeCreator(collectYouTubeMeta(() => undefined))).toBeNull();
  });

  it('ignores a url-only page: CreatorInfo is keyed on the name', () => {
    const creator = pickYouTubeCreator(
      collectYouTubeMeta(
        readerFor({ '[itemprop=author] [itemprop=url]': { href: '/@someone' } }),
      ),
    );

    expect(creator).toBeNull();
  });
});

describe('collectCreatorMeta + pickCreator (Bilibili)', () => {
  it('reads the UP name out of the head metadata first', () => {
    const creator = pickBilibiliCreator(
      collectBilibiliMeta(
        readerFor({
          'meta[name=author]': { content: '某某UP主' },
          '#v_upinfo .username': { text: 'DOM 里的名字' },
          'a[href*="space.bilibili.com"]': {
            href: '//space.bilibili.com/12345',
          },
        }),
      ),
    );

    expect(creator).toEqual({
      name: '某某UP主',
      url: 'https://space.bilibili.com/12345',
    });
  });

  it('falls back to the DOM name when the head metadata is missing', () => {
    const creator = pickBilibiliCreator(
      collectBilibiliMeta(
        readerFor({ '#v_upinfo .username': { text: 'DOM UP主' } }),
      ),
    );

    expect(creator).toEqual({ name: 'DOM UP主', url: null });
  });

  it('normalizes a root-relative uploader link', () => {
    const creator = pickBilibiliCreator(
      collectBilibiliMeta(
        readerFor({
          'a.up-name': { text: 'UP' },
          'a[href*="space.bilibili.com"]': { href: '/12345' },
        }),
      ),
    );

    expect(creator?.url).toBe('https://www.bilibili.com/12345');
  });

  it('never reads h1[title], which holds the video title', () => {
    const creator = pickBilibiliCreator(
      collectBilibiliMeta(
        readerFor({ 'h1[title]': { text: '视频标题，不是 UP 主' } }),
      ),
    );

    expect(creator).toBeNull();
  });

  it('ignores blank and whitespace-only values', () => {
    const creator = pickBilibiliCreator(
      collectBilibiliMeta(
        readerFor({
          'meta[name=author]': { content: '   ' },
          '#v_upinfo .username': { text: '   ' },
        }),
      ),
    );

    expect(creator).toBeNull();
  });
});