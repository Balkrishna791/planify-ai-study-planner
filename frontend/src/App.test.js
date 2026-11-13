import { render, screen } from '@testing-library/react';
import App from './App';

beforeEach(() => {
  localStorage.clear();
});

test('renders the Planify public landing page', () => {
  render(<App />);
  expect(screen.getAllByText('Planify').length).toBeGreaterThan(0);
  expect(screen.getByText(/Plan what matters/i)).toBeInTheDocument();
  expect(screen.getAllByRole('button', { name: /create free account/i }).length).toBeGreaterThan(0);
});

test('recovers from corrupted user storage', () => {
  localStorage.setItem('user', '{invalid-json');
  render(<App />);
  expect(screen.getByText(/Make your next study session count/i)).toBeInTheDocument();
  expect(localStorage.getItem('user')).toBeNull();
});

test('opens the public privacy page from its direct URL', () => {
  window.history.pushState({}, '', '/privacy');
  render(<App />);
  expect(screen.getByRole('heading', { name: /privacy policy/i })).toBeInTheDocument();
  expect(screen.getByText(/analytics are off unless you choose allow/i)).toBeInTheDocument();
  window.history.pushState({}, '', '/');
});
