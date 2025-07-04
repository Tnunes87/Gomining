// ===== database.js =====
(async function(){
  const db = await openDB();

  // Lecture de toutes les opérations
  async function getAll() {
    return new Promise(resolve => {
      const tx = db.transaction('operations', 'readonly');
      const store = tx.objectStore('operations');
      const req = store.getAll();
      req.onsuccess = () => resolve(req.result);
    });
  }

  // Ajout d’une opération
  async function addOp(op) {
    const tx = db.transaction('operations', 'readwrite');
    tx.objectStore('operations').add(op);
    return tx.complete;
  }

  // Suppression par id
  async function deleteOp(id) {
    const tx = db.transaction('operations', 'readwrite');
    tx.objectStore('operations').delete(id);
    return tx.complete;
  }

  // Exposez les fonctions à l’app
  window.dbAPI = { getAll, addOp, deleteOp };

  // Initialisation au chargement
  document.addEventListener('DOMContentLoaded', async () => {
    const ops = await window.dbAPI.getAll();
    // Assurez-vous d’avoir un conteneur <tbody id="operations-body">
    const tbody = document.getElementById('operations-body');
    ops.forEach(o => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${formatDate(o.date)}</td>
        <td>${o.satoshis}</td>
        <td>${o.electricite}</td>
        <td>${o.service}</td>
        <td><button data-id="${o.id}" class="delete-btn">Supprimer</button></td>
      `;
      tbody.appendChild(tr);
    });
    // Gestion des suppressions
    tbody.addEventListener('click', async e => {
      if (e.target.matches('.delete-btn')) {
        const id = Number(e.target.dataset.id);
        await window.dbAPI.deleteOp(id);
        e.target.closest('tr').remove();
      }
    });
  });
})();
