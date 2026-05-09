import { createRootRoute, createRoute, Outlet } from '@tanstack/react-router';
import { LoginPage } from './pages/LoginPage';
import { CallbackPage } from './pages/CallbackPage';
import { PatientPickerPage } from './pages/PatientPickerPage';
import { PatientDashboardPage } from './pages/PatientDashboardPage';

const rootRoute = createRootRoute({
  component: () => <Outlet />,
});

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  component: LoginPage,
});

const callbackRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/callback',
  component: CallbackPage,
});

const patientsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/patients',
  component: PatientPickerPage,
});

const patientDetailRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/patient/$patientId',
  component: PatientDashboardPage,
});

export const routeTree = rootRoute.addChildren([
  indexRoute,
  callbackRoute,
  patientsRoute,
  patientDetailRoute,
]);
