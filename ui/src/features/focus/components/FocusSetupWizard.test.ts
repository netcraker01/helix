/**
 * Focus setup wizard tests.
 *
 * Verifies the wizard mounts, navigates through steps, accepts the goal and
 * intention inputs, exposes the chosen setup, and dispatches a start event.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import FocusSetupWizard from './FocusSetupWizard.svelte';
import TestWrapper from './FocusSetupWizardTestWrapper.svelte';

const tMap = new Map<string, string>([
  ['focus.wizard.title', 'Set up your focus session'],
  ['focus.wizard.step_intention', 'Intention'],
  ['focus.wizard.step_workflow', 'Workflow'],
  ['focus.wizard.step_goal', 'Goal & first action'],
  ['focus.wizard.step_music', 'Music'],
  ['focus.wizard.step_options', 'Options'],
  ['focus.wizard.step_review', 'Review'],
  ['focus.wizard.intention_label', 'What are you focusing on?'],
  ['focus.wizard.intention_placeholder', 'e.g. Write the quarterly report'],
  ['focus.wizard.workflow_label', 'Choose a workflow'],
  ['focus.wizard.workflow_pomodoro_name', 'pomodoro'],
  ['focus.wizard.workflow_pomodoro_desc', 'Short focused sprints.'],
  ['focus.wizard.workflow_pomodoro_music', 'Lo-fi'],
  ['focus.wizard.workflow_deepwork_name', 'Deep Work'],
  ['focus.wizard.workflow_deepwork_desc', 'Long blocks.'],
  ['focus.wizard.workflow_deepwork_music', 'Ambient'],
  ['focus.wizard.workflow_quick_name', 'Quick Focus'],
  ['focus.wizard.workflow_quick_desc', 'Short burst.'],
  ['focus.wizard.workflow_quick_music', 'Energetic'],
  ['focus.wizard.goal_label', 'Goal for this session'],
  ['focus.wizard.goal_placeholder', 'e.g. Finish the intro'],
  ['focus.wizard.action_label', 'First action'],
  ['focus.wizard.action_placeholder', 'e.g. Open the doc'],
  ['focus.wizard.music_label', 'Choose your music strategy'],
  ['focus.wizard.music_none', 'No music'],
  ['focus.wizard.music_continue', 'Continue playing current track'],
  ['focus.wizard.music_search', 'Search for background music'],
  ['focus.wizard.preset_lofi', 'Lo-fi'],
  ['focus.wizard.preset_ambient', 'Ambient'],
  ['focus.wizard.preset_classical', 'Classical'],
  ['focus.wizard.preset_jazz', 'Jazz'],
  ['focus.wizard.preset_nature', 'Nature'],
  ['focus.wizard.music_query_placeholder', 'Or type your own search...'],
  ['focus.wizard.option_skip_breaks', 'Skip breaks'],
  ['focus.wizard.option_strict_mode', 'Strict mode'],
  ['focus.wizard.options_note', 'Preferences only.'],
  ['focus.wizard.review_intention', 'Intention'],
  ['focus.wizard.review_workflow', 'Workflow'],
  ['focus.wizard.review_goal', 'Goal'],
  ['focus.wizard.review_music', 'Music'],
  ['focus.wizard.review_unset', 'Not set'],
  ['focus.wizard.start', 'Start session'],
  ['common.cancel', 'Cancel'],
  ['common.back', 'Back'],
  ['common.save', 'Save'],
  ['common.close', 'Close'],
]);

vi.mock('@i18n', () => ({
  t: {
    subscribe(fn: (value: (key: string) => string) => void) {
      fn((key: string) => tMap.get(key) ?? key);
      return () => {};
    },
  },
}));

describe('FocusSetupWizard', () => {
  beforeEach(() => {
    tMap.set('focus.wizard.workflow_pomodoro_music', 'Lo-fi');
    tMap.set('focus.wizard.coming_soon', 'Coming soon');
  });

  it('does not render when closed', () => {
    const { container } = render(FocusSetupWizard, { props: { open: false } });
    expect(container.querySelector('.wizard-overlay')).toBeNull();
  });

  it('renders the first step when opened', () => {
    render(FocusSetupWizard, { props: { open: true } });
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(screen.getByLabelText('What are you focusing on?')).toBeTruthy();
  });

  it('navigates through steps using the primary action', async () => {
    render(FocusSetupWizard, { props: { open: true } });

    await fireEvent.input(screen.getByLabelText('What are you focusing on?'), {
      target: { value: 'Deep work' },
    });
    await fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(screen.getByRole('radiogroup', { name: 'Choose a workflow' })).toBeTruthy();
    await fireEvent.click(screen.getByRole('button', { name: /Quick Focus/i }));
    await fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(screen.getByLabelText('Goal for this session')).toBeTruthy();
    await fireEvent.input(screen.getByLabelText('Goal for this session'), {
      target: { value: 'Ship the fix' },
    });
    await fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(screen.getByRole('radiogroup', { name: 'Choose your music strategy' })).toBeTruthy();
    await fireEvent.click(screen.getByLabelText('Search for background music'));
    await fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(screen.getByText(/Skip breaks/i)).toBeTruthy();
    await fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(screen.getByText('Workflow')).toBeTruthy();
    expect(screen.getByText('quickFocus')).toBeTruthy();
  });

  it('allows going back and forth', async () => {
    render(FocusSetupWizard, { props: { open: true } });

    await fireEvent.input(screen.getByLabelText('What are you focusing on?'), {
      target: { value: 'Deep work' },
    });
    await fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(screen.getByRole('radiogroup', { name: 'Choose a workflow' })).toBeTruthy();

    await fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(screen.getByLabelText('What are you focusing on?')).toBeTruthy();
    expect(screen.getByDisplayValue('Deep work')).toBeTruthy();
  });

  it('cancels from the first step', async () => {
    const closeHandler = vi.fn();
    render(TestWrapper, { props: { open: true, onClose: closeHandler } });

    await fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(closeHandler).toHaveBeenCalledTimes(1);
  });

  it('emits start with the composed setup from the review step', async () => {
    const startHandler = vi.fn();
    render(TestWrapper, { props: { open: true, onStart: startHandler } });

    await fireEvent.input(screen.getByLabelText('What are you focusing on?'), {
      target: { value: 'Write specs' },
    });
    await fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await fireEvent.click(screen.getByRole('button', { name: /Deep Work/i }));
    await fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await fireEvent.input(screen.getByLabelText('Goal for this session'), {
      target: { value: 'Finish outline' },
    });
    await fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await fireEvent.click(screen.getByLabelText('Search for background music'));
    await fireEvent.input(screen.getByPlaceholderText('Or type your own search...'), {
      target: { value: 'ambient' },
    });
    await fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(startHandler).toHaveBeenCalledTimes(0);
    await fireEvent.click(screen.getByRole('button', { name: 'Start session' }));
    expect(startHandler).toHaveBeenCalledTimes(1);
  });

  it('exposes the chosen setup via getSetup()', async () => {
    let wizardRef: FocusSetupWizard | null = null;
    render(TestWrapper, {
      props: { open: true, bindWizard: (ref: FocusSetupWizard) => { wizardRef = ref; } },
    });

    await waitFor(() => expect(wizardRef).not.toBeNull());

    await fireEvent.input(screen.getByLabelText('What are you focusing on?'), {
      target: { value: 'Code review' },
    });
    await fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await fireEvent.click(screen.getByRole('button', { name: /Pomodoro/i }));
    await fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await fireEvent.input(screen.getByLabelText('Goal for this session'), {
      target: { value: 'Clear backlog' },
    });
    await fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await fireEvent.click(screen.getByLabelText('Search for background music'));
    await fireEvent.input(screen.getByPlaceholderText('Or type your own search...'), {
      target: { value: 'chill beats' },
    });
    await fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(screen.getByText(/Skip breaks/i)).toBeTruthy();
    await fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    const setup = wizardRef!.getSetup();
    expect(setup.intention).toBe('Code review');
    expect(setup.workflow).toBe('pomodoro');
    expect(setup.goal).toBe('Clear backlog');
    expect(setup.firstAction).toBe('');
    expect(setup.musicStrategy).toEqual({ kind: 'query', value: 'chill beats' });
    expect(setup.skipBreaks).toBe(false);
    expect(setup.cadence.workDurationMs).toBe(25 * 60 * 1000);
  });

  it('resets state when reopened after closing', async () => {
    let wizardRef: FocusSetupWizard | null = null;
    const { rerender } = render(TestWrapper, {
      props: {
        open: true,
        bindWizard: (ref: FocusSetupWizard) => { wizardRef = ref; },
      },
    });
    await waitFor(() => expect(wizardRef).not.toBeNull());

    await fireEvent.input(screen.getByLabelText('What are you focusing on?'), {
      target: { value: 'Deep work' },
    });
    await fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await rerender({ open: false });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

    await rerender({ open: true });
    await waitFor(() => expect(screen.getByRole('dialog')).toBeTruthy());
    expect(wizardRef!.getSetup().intention).toBe('');
  });
});
