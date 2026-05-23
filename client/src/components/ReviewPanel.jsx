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
      background: 'linear-gradient(155deg, rgba(72, 60, 104, 0.44), rgba(20, 16, 36, 0.68))',
      border: '1px solid rgba(222, 204, 255, 0.22)',
      borderRadius: '20px',
      boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.12), 0 18px 50px rgba(0,0,0,0.24)',
      backdropFilter: 'blur(20px) saturate(1.2)',
      padding: '20px',
      marginBottom: '16px',
    }}>
      <h3 style={{ color: '#c4a1ff', fontSize: '16px', fontWeight: 700, marginBottom: '8px' }}>
        Kiểm tra bước {stepNumber}: {stepName}
      </h3>

      <div style={{
        background: 'rgba(23,18,39,0.72)',
        border: '1px solid rgba(222,204,255,0.14)',
        borderRadius: '14px',
        padding: '12px',
        maxHeight: '300px',
        overflowY: 'auto',
        marginBottom: '16px',
        fontSize: '13px',
        color: '#d1d5db',
        whiteSpace: 'pre-wrap',
        fontFamily: 'monospace',
      }}>
        {result ? result.substring(0, 2000) + (result.length > 2000 ? '\n\n... (đã rút gọn)' : '') : 'Chưa có kết quả.'}
      </div>

      {showEdit && (
        <div style={{ marginBottom: '12px' }}>
          <textarea
            value={editMessage}
            onChange={(event) => setEditMessage(event.target.value)}
            placeholder="Gõ yêu cầu chỉnh sửa... VD: Thêm chi tiết về nhân vật Robert"
            style={{
              width: '100%',
              minHeight: '80px',
              background: '#171227',
              border: '1px solid rgba(222,204,255,0.18)',
              borderRadius: '14px',
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
                background: editMessage.trim() ? 'linear-gradient(to right, #f3e8ff, #c4a1ff, #9f7aea)' : '#374151',
                color: editMessage.trim() ? '#2f174a' : '#6b7280',
                fontWeight: 600, fontSize: '13px', cursor: editMessage.trim() ? 'pointer' : 'not-allowed',
                border: 'none',
              }}
            >
              Gửi chỉnh sửa
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
              Hủy
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
              background: 'linear-gradient(to right, #f3e8ff, #c4a1ff, #9f7aea)',
              color: '#2f174a', fontWeight: 700, fontSize: '14px',
              cursor: 'pointer', border: 'none',
            }}
          >
            Tiếp tục bước sau
          </button>
          <button
            type="button"
            onClick={onContinueAuto}
            style={{
              padding: '10px 20px', borderRadius: '8px',
              background: 'rgba(196,161,255,0.18)', border: '1px solid rgba(196,161,255,0.35)',
              color: '#c4a1ff', fontWeight: 700, fontSize: '14px',
              cursor: 'pointer',
            }}
          >
            Chạy Auto từ đây
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
            Chỉnh sửa
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
            Chạy lại bước này
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
            Dừng pipeline
          </button>
        </div>
      )}
    </div>
  )
}

export default ReviewPanel
