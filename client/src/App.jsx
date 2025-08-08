import React, { useEffect, useMemo, useRef, useState } from 'react';
import { MapContainer, TileLayer, Marker, Popup, Circle, useMap } from 'react-leaflet';
import L from 'leaflet';
import { io } from 'socket.io-client';
import markerIcon2x from 'leaflet/dist/images/marker-icon-2x.png';
import markerIcon from 'leaflet/dist/images/marker-icon.png';
import markerShadow from 'leaflet/dist/images/marker-shadow.png';
import './App.css';

L.Icon.Default.mergeOptions({
  iconRetinaUrl: markerIcon2x,
  iconUrl: markerIcon,
  shadowUrl: markerShadow,
});

const SOCKET_URL = import.meta.env.VITE_SOCKET_URL || 'http://localhost:4000';

function RecenterMap({ center }) {
  const map = useMap();
  useEffect(() => {
    if (center) {
      map.setView(center, map.getZoom());
    }
  }, [center, map]);
  return null;
}

export default function App() {
  const [userPosition, setUserPosition] = useState(null);
  const [watchId, setWatchId] = useState(null);
  const [guardians, setGuardians] = useState([]);
  const [isGuardian, setIsGuardian] = useState(false);
  const [alias, setAlias] = useState(() => `Guardian-${Math.random().toString(36).slice(2, 6)}`);
  const [helpRequests, setHelpRequests] = useState([]);
  const [assignedGuardian, setAssignedGuardian] = useState(null);
  const socketRef = useRef(null);

  const formatLocation = (g) => {
    const lat = g?.lat;
    const lng = g?.lng;
    if (typeof lat === 'number' && typeof lng === 'number') {
      return `[${lat.toFixed(3)}, ${lng.toFixed(3)}]`;
    }
    return 'Unknown';
  };

  useEffect(() => {
    const socket = io(SOCKET_URL, { transports: ['websocket'] });
    socketRef.current = socket;

    socket.on('guardianList', (list) => {
      setGuardians(Array.isArray(list) ? list : []);
    });

    socket.on('helpRequest', (payload) => {
      if (isGuardian) {
        setHelpRequests((prev) => [payload, ...prev].slice(0, 50));
      }
    });

    socket.on('helpAssigned', ({ requesterSocketId }) => {
      setHelpRequests((prev) => prev.filter((r) => r.requesterSocketId !== requesterSocketId));
    });

    socket.on('helpAlreadyAssigned', () => {
      alert('This request was already assigned to another guardian.');
    });

    socket.on('helpAccepted', ({ guardian }) => {
      setAssignedGuardian(guardian || null);
    });

    return () => {
      socket.disconnect();
    };
  }, [isGuardian]);

  useEffect(() => {
    if (!('geolocation' in navigator)) {
      return;
    }
    const id = navigator.geolocation.watchPosition(
      (pos) => {
        const next = { lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy };
        setUserPosition(next);
        if (isGuardian && socketRef.current) {
          socketRef.current.emit('updateLocation', next);
        }
      },
      () => {},
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 10000 }
    );
    setWatchId(id);
    return () => {
      if (watchId != null) navigator.geolocation.clearWatch(watchId);
    };
  }, [isGuardian]);

  useEffect(() => {
    if (!isGuardian || !socketRef.current) return;
    const payload = { alias };
    if (userPosition && typeof userPosition.lat === 'number' && typeof userPosition.lng === 'number') {
      payload.lat = userPosition.lat;
      payload.lng = userPosition.lng;
    }
    socketRef.current.emit('registerGuardian', payload);
  }, [isGuardian, alias, userPosition?.lat, userPosition?.lng]);

  const mapCenter = userPosition ? [userPosition.lat, userPosition.lng] : [37.7749, -122.4194];

  const handleToggleGuardian = () => {
    setIsGuardian((prev) => !prev);
  };

  const requestGuardian = () => {
    if (!socketRef.current) return;
    const payload = userPosition ? { ...userPosition } : {};
    socketRef.current.emit('requestHelp', payload);
    alert('Help requested. Nearby guardians will be notified.');
  };

  const acceptRequest = (req) => {
    if (!socketRef.current) return;
    socketRef.current.emit('acceptHelp', { requesterSocketId: req.requesterSocketId });
  };

  const guardiansAll = useMemo(() => (Array.isArray(guardians) ? guardians : []), [guardians]);
  const guardianMarkers = useMemo(() => guardiansAll.filter((g) => g.lat && g.lng), [guardiansAll]);

  return (
    <div className="app">
      <div className="topbar">
        <div className="left">
          <strong>Guardians</strong>
        </div>
        <div className="right">
          <input value={alias} onChange={(e) => setAlias(e.target.value)} className="alias" placeholder="Your alias" />
          <button onClick={handleToggleGuardian} className={isGuardian ? 'secondary' : 'primary'}>
            {isGuardian ? 'Stop Being Guardian' : 'Become Guardian'}
          </button>
          <button onClick={requestGuardian} className="danger">
            Request Guardian
          </button>
        </div>
      </div>

      <div className="content">
        <div className="map">
          <MapContainer center={mapCenter} zoom={14} style={{ height: '100%', width: '100%' }}>
            <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" attribution="&copy; OpenStreetMap contributors" />
            {userPosition && (
              <>
                <Marker position={[userPosition.lat, userPosition.lng]}>
                  <Popup>
                    <div>
                      <div><strong>You</strong></div>
                      {userPosition.accuracy && <div>{Math.round(userPosition.accuracy)} m</div>}
                    </div>
                  </Popup>
                </Marker>
                {userPosition.accuracy && (
                  <Circle center={[userPosition.lat, userPosition.lng]} radius={Math.min(userPosition.accuracy, 150)} pathOptions={{ color: '#3b82f6' }} />
                )}
                <RecenterMap center={[userPosition.lat, userPosition.lng]} />
              </>
            )}

            {guardianMarkers.map((g) => (
              <Marker key={g.socketId} position={[g.lat, g.lng]}>
                <Popup>
                  <div>
                    <div><strong>{g.alias || 'Guardian'}</strong></div>
                    <div>Online</div>
                  </div>
                </Popup>
              </Marker>
            ))}
          </MapContainer>
        </div>
        <div className="sidebar">
          <div className="card">
            <div className="card-title">All Guardians</div>
            {guardiansAll.length === 0 && <div>None</div>}
            {guardiansAll.map((g) => (
              <div key={g.socketId} className="row">
                <span>{g.alias || g.socketId}</span>
                <span className="muted">{formatLocation(g)}</span>
              </div>
            ))}
          </div>

          {assignedGuardian ? (
            <div className="card success">
              <div><strong>Guardian assigned:</strong> {assignedGuardian.alias || assignedGuardian.socketId}</div>
            </div>
          ) : (
            <div className="card">No guardian assigned yet.</div>
          )}

          {isGuardian && (
            <div className="card">
              <div className="card-title">Incoming help requests</div>
              {helpRequests.length === 0 && <div>None</div>}
              {helpRequests.map((req, idx) => (
                <div className="request" key={idx}>
                  <div>Requester nearby at [{req.lat?.toFixed?.(4)}, {req.lng?.toFixed?.(4)}]</div>
                  <button onClick={() => acceptRequest(req)} className="primary small">Accept</button>
                </div>
              ))}
            </div>
          )}

          <div className="card">
            <div className="card-title">Guardians online</div>
            {guardianMarkers.length === 0 && <div>None nearby</div>}
            {guardianMarkers.map((g) => (
              <div key={g.socketId} className="row">
                <span>{g.alias || g.socketId}</span>
                <span className="muted">[{g.lat?.toFixed?.(3)}, {g.lng?.toFixed?.(3)}]</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
