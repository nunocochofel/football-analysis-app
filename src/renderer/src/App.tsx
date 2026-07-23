import { useState } from 'react'
import type { Match } from '@shared/types'
import MatchSetup from './components/MatchSetup/MatchSetup'
import Workspace from './components/Workspace/Workspace'

export default function App(): JSX.Element {
  const [activeMatch, setActiveMatch] = useState<Match | null>(null)

  if (activeMatch) {
    return <Workspace match={activeMatch} onBack={() => setActiveMatch(null)} />
  }
  return <MatchSetup onMatchReady={setActiveMatch} />
}
