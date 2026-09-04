import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { ThemeProvider } from './ThemeProvider';
import { EntryRoute } from '../routes/EntryRoute';
import { HostNewRoute, HowToPlayRoute, NotFoundRoute, QuestionsRoute, RoomRoute } from '../routes/GameRoutes';

export function App() {
  return (
    <ThemeProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<EntryRoute />} />
          <Route path="/how-to-play" element={<HowToPlayRoute />} />
          <Route path="/host/new" element={<HostNewRoute />} />
          <Route path="/room/:roomCode/lobby" element={<RoomRoute surface="lobby" />} />
          <Route path="/room/:roomCode/host" element={<RoomRoute surface="host" />} />
          <Route path="/room/:roomCode/play" element={<RoomRoute surface="play" />} />
          <Route path="/room/:roomCode/display" element={<RoomRoute surface="display" />} />
          <Route path="/room/:roomCode/results" element={<RoomRoute surface="results" />} />
          <Route path="/questions" element={<QuestionsRoute />} />
          <Route path="/questions/new" element={<QuestionsRoute />} />
          <Route path="/questions/:questionId" element={<QuestionsRoute />} />
          <Route path="*" element={<NotFoundRoute />} />
        </Routes>
      </BrowserRouter>
    </ThemeProvider>
  );
}
