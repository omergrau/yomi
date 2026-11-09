import { Redirect } from 'expo-router';

// Any unknown address, such as a preview hosted under its own path, opens the day screen.
export default function NotFound() {
  return <Redirect href="/" />;
}
