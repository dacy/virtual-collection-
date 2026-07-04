import { useEffect, useState } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import { useRef } from 'react'
import type { Mesh } from 'three'

function useHashRoute(): string {
  const [route, setRoute] = useState(() => window.location.hash.slice(1) || '/')
  useEffect(() => {
    const onChange = () => setRoute(window.location.hash.slice(1) || '/')
    window.addEventListener('hashchange', onChange)
    return () => window.removeEventListener('hashchange', onChange)
  }, [])
  return route
}

function Placeholder() {
  const mesh = useRef<Mesh>(null)
  useFrame((_, delta) => {
    if (mesh.current) mesh.current.rotation.y += delta * 0.4
  })
  return (
    <mesh ref={mesh}>
      <torusKnotGeometry args={[1, 0.32, 128, 32]} />
      <meshStandardMaterial color="#b08d57" metalness={0.8} roughness={0.3} />
    </mesh>
  )
}

function Home() {
  return (
    <div style={{ height: '100%', position: 'relative' }}>
      <Canvas camera={{ position: [0, 0, 4], fov: 50 }}>
        <ambientLight intensity={0.4} />
        <directionalLight position={[3, 4, 5]} intensity={1.6} />
        <Placeholder />
      </Canvas>
      <div style={{ position: 'absolute', top: '2rem', left: 0, right: 0, textAlign: 'center' }}>
        <h1 style={{ fontWeight: 300, letterSpacing: '0.2em' }}>VIRTUAL COLLECTION</h1>
        <p style={{ opacity: 0.6, marginTop: '0.5rem' }}>
          Your collection stays on your device — nothing is ever uploaded.
        </p>
      </div>
    </div>
  )
}

export function App() {
  const route = useHashRoute()
  void route
  return <Home />
}
