import { useState } from 'react'

function ReviewPanel({ stepNumber, stepName, result, onContinue, onContinueAuto, onEdit, onRedo, onStop }) {
  const [editMessage, setEditMessage] = useState('')
  const [showEdit, setShowEdit] = useState(false)

  const handleSendEdit = () => {
    if (editMessage.trim()) {
      onEdit(editMessage.trim())
      setEditMessage('')
      setShowEdit(false)
    }
  }

  return (
    <div style={{
      background: '#1a1a2e',
      border: '1px solid rgba(0, 212, 170, 0.24)',
      borderRadius: '12px',
      padding: '20px',
      marginBottom: '16px',
    }}>
      <h3 style={{ color: '#00d4aa', fontSize: '16px', fontWeight: 700, marginBottom: '8px' }}>
        Review Step {stepNumber}: {stepName}
      </h3>

      <div style={{
        background: '#10101d',
        border: '1px solid rgba(255,255,255,0.08)',
        borderRadius: '8px',
        padding: '12px',
        maxHeight: '300px',
        overflowY: 'auto',
        marginBottom: '16px',
        fontSize: '13px',
        color: '#d1d5db',
        whiteSpace: 'pre-wrap',
        fontFamily: 'monospace',
      }}>
        {result ? result.substring(0, 2000) + (result.length > 2000 ? '\n\n... (truncated)' : '') : 'No result yet.'}
      </div>

      {showEdit && (
        <div style={{ marginBottom: '12px' }}>
          <textarea
            value={editMessage}
            onChange={(event) => setEditMessage(event.target.value)}
            placeholder="Go yeu cau chinh sua... VD: Them chi tiet ve nhan vat Robert"
            style={{
              width: '100%',
              minHeight: '80px',
              background: '#10101d',
              border: '1px solid rgba(255,255,255,0.15)',
              borderRadius: '8px',
              padding: '10px',
              color: 'white',
              fontSize: '13px',
              resize: 'vertical',
              outline: 'none',
            }}
          />
          <div style={{ display: 'flex', gap: '8px', marginTop: '8px' }}>
            <button
              type="button"
              onClick={handleSendEdit}
              disabled={!editMessage.trim()}
              style={{
                padding: '8px 16px', borderRadius: '8px',
                background: editMessage.trim() ? '#00d4aa' : '#374151',
                color: editMessage.trim() ? 'black' : '#6b7280',
                fontWeight: 600, fontSize: '13px', cursor: editMessage.trim() ? 'pointer' : 'not-allowed',
                border: 'none',
              }}
            >
              Gui chinh sua
            </button>
            <button
              type="button"
              onClick={() => { setShowEdit(false); setEditMessage('') }}
              style={{
                padding: '8px 16px', borderRadius: '8px',
                background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)',
                color: '#9ca3af', fontSize: '13px', cursor: 'pointer',
              }}
            >
              Huy
            </button>
          </div>
        </div>
      )}

      {!showEdit && (
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          <button
            type="button"
            onClick={onContinue}
            style={{
              padding: '10px 20px', borderRadius: '8px',
              background: 'linear-gradient(to right, #00d4aa, #00b894)',
              color: 'black', fontWeight: 700, fontSize: '14px',
              cursor: 'pointer', border: 'none',
            }}
          >
            Tiep tuc buoc sau
          </button>
          <button
            type="button"
            onClick={onContinueAuto}
            style={{
              padding: '10px 20px', borderRadius: '8px',
              background: 'rgba(0,212,170,0.12)', border: '1px solid rgba(0,212,170,0.35)',
              color: '#00d4aa', fontWeight: 700, fontSize: '14px',
              cursor: 'pointer',
            }}
          >
            Chay Auto tu day
          </button>
          <button
            type="button"
            onClick={() => setShowEdit(true)}
            style={{
              padding: '10px 20px', borderRadius: '8px',
              background: 'rgba(234,179,8,0.15)', border: '1px solid rgba(234,179,8,0.3)',
              color: '#eab308', fontWeight: 600, fontSize: '14px', cursor: 'pointer',
            }}
          >
            Chinh sua
          </button>
          <button
            type="button"
            onClick={onRedo}
            style={{
              padding: '10px 20px', borderRadius: '8px',
              background: 'rgba(59,130,246,0.15)', border: '1px solid rgba(59,130,246,0.3)',
              color: '#3b82f6', fontWeight: 600, fontSize: '14px', cursor: 'pointer',
            }}
          >
            Chay lai buoc nay
          </button>
          <button
            type="button"
            onClick={onStop}
            style={{
              padding: '10px 20px', borderRadius: '8px',
              background: 'rgba(239,68,68,0.15)', border: '1px solid rgba(239,68,68,0.3)',
              color: '#ef4444', fontWeight: 600, fontSize: '14px', cursor: 'pointer',
            }}
          >
            Dung pipeline
          </button>
        </div>
      )}
    </div>
  )
}

export default ReviewPanel
