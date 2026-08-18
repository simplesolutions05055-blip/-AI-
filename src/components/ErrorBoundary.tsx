import React from 'react';
import ErrorPage from '@/pages/ErrorPage';
import { logError } from '@/lib/errorReporting';

interface Props {
  children: React.ReactNode;
  /** Identifies which boundary caught it, so the log says where the app broke. */
  boundaryName: string;
}

interface State {
  hasError: boolean;
}

/**
 * React unmounts the ENTIRE tree when a component throws during render. Without
 * a boundary the user gets a blank white page and leaves — no message, nothing
 * in any log you can see.
 *
 * ⚠️ A boundary catches render errors ONLY. Errors from event handlers, timers
 * and rejected promises never reach it — those are covered by the global
 * listeners in installGlobalErrorHandlers().
 */
export default class ErrorBoundary extends React.Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    // critical=true: the user is looking at a broken screen right now.
    void logError(
      `render_crash:${this.props.boundaryName}`,
      Object.assign(error, {
        stack: `${error.stack ?? ''}\n\nComponent stack:${errorInfo.componentStack ?? ''}`,
      }),
      true,
    );
  }

  reset = () => this.setState({ hasError: false });

  render() {
    if (!this.state.hasError) return this.props.children;

    return (
      <ErrorPage
        code="500"
        title="משהו השתבש"
        message="נתקלנו בתקלה בטעינת המסך הזה. הדיווח כבר נשלח אלינו — אפשר לנסות שוב או לחזור לדף הבית."
        onRetry={this.reset}
      />
    );
  }
}
