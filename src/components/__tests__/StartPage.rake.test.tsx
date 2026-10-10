import { render, screen, fireEvent } from '@testing-library/react';
import { StartPage } from '../StartPage';
import { translations } from '../../utils/translations';
import { NO_RAKE } from '../../utils/rake';

const sp = translations.startPage;
const t = sp.rake;

const setup = () => {
  const onStartGame = jest.fn();
  render(<StartPage onStartGame={onStartGame} onResumeGame={jest.fn()} />);
  return onStartGame;
};

const startBtn = () => screen.getByText(sp.startGame);
const rakeValueInput = () => screen.getByLabelText(t.valueAria) as HTMLInputElement;
const rakeCapInput = () => screen.getByLabelText(t.capAria) as HTMLInputElement;

describe('StartPage 抽水配置', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('默认不抽水：不显示数值输入，透传 NO_RAKE', () => {
    const onStartGame = setup();
    expect(screen.getByText(t.none)).toBeTruthy();
    expect(screen.queryByLabelText(t.valueAria)).toBeNull();
    expect(screen.queryByLabelText(t.capAria)).toBeNull();

    fireEvent.click(startBtn());
    expect(onStartGame).toHaveBeenCalledWith(2, 0, 5, NO_RAKE);
  });

  it('按百分比 5% 封顶 3BB：摘要把封顶换算成筹码，透传值正确', () => {
    const onStartGame = setup();
    fireEvent.click(screen.getByText(t.modePercent));
    fireEvent.change(rakeValueInput(), { target: { value: '5' } });
    fireEvent.change(rakeCapInput(), { target: { value: '3' } });

    // 小盲 5 → 大盲 10，封顶 3BB = $30
    expect(screen.getByText(t.percent(5, 3, 30))).toBeTruthy();

    fireEvent.click(startBtn());
    expect(onStartGame).toHaveBeenCalledWith(2, 0, 5, {
      mode: 'percent',
      value: 5,
      capBB: 3,
    });
  });

  it('固定大盲：不显示封顶输入（抽水本身已是固定值）', () => {
    setup();
    fireEvent.click(screen.getByText(t.modeBb));
    fireEvent.change(rakeValueInput(), { target: { value: '2' } });

    expect(screen.queryByLabelText(t.capAria)).toBeNull();
    expect(screen.getByText(t.bb(2))).toBeTruthy();
  });

  it('固定大盲提交时 capBB 归零（即便之前在百分比模式下填过封顶）', () => {
    const onStartGame = setup();
    fireEvent.click(screen.getByText(t.modePercent));
    fireEvent.change(rakeCapInput(), { target: { value: '3' } });
    fireEvent.click(screen.getByText(t.modeBb));
    fireEvent.change(rakeValueInput(), { target: { value: '2' } });

    fireEvent.click(startBtn());
    expect(onStartGame).toHaveBeenCalledWith(2, 0, 5, { mode: 'bb', value: 2, capBB: 0 });
  });

  it('切回百分比模式时封顶值还在（状态没被清掉）', () => {
    setup();
    fireEvent.click(screen.getByText(t.modePercent));
    fireEvent.change(rakeCapInput(), { target: { value: '3' } });
    fireEvent.click(screen.getByText(t.modeBb));
    fireEvent.click(screen.getByText(t.modePercent));

    expect(rakeCapInput().value).toBe('3');
  });

  it('数值超上限被夹到上限（比例上限 20）', () => {
    setup();
    fireEvent.click(screen.getByText(t.modePercent));
    fireEvent.change(rakeValueInput(), { target: { value: '999' } });
    expect(rakeValueInput().value).toBe('20');
  });

  it('负值被夹到 0', () => {
    setup();
    fireEvent.click(screen.getByText(t.modePercent));
    fireEvent.change(rakeValueInput(), { target: { value: '-3' } });
    expect(rakeValueInput().value).toBe('0');
  });

  it('切换模式不会清掉已填的数值', () => {
    setup();
    fireEvent.click(screen.getByText(t.modePercent));
    fireEvent.change(rakeValueInput(), { target: { value: '5' } });
    fireEvent.click(screen.getByText(t.modeBb));
    expect(rakeValueInput().value).toBe('5');
  });

  it('切模式时按新模式的上限重新夹取（比例 15 → 大盲上限 10）', () => {
    setup();
    fireEvent.click(screen.getByText(t.modePercent));
    fireEvent.change(rakeValueInput(), { target: { value: '15' } });
    expect(rakeValueInput().value).toBe('15');
    fireEvent.click(screen.getByText(t.modeBb));
    expect(rakeValueInput().value).toBe('10');
  });

  it('数值为 0 时摘要回到「不抽水」，与模式为 none 等效', () => {
    setup();
    fireEvent.click(screen.getByText(t.modePercent));
    expect(screen.getByText(t.none)).toBeTruthy();
  });

  it('锦标赛提示常驻（抽水与 ICM 互斥，用户要知道）', () => {
    setup();
    expect(screen.getByText(t.tournamentNote)).toBeTruthy();
  });
});
