Component({
  properties: { event: Object, editLabel: String, sourceLabel: String },
  methods: { edit() { this.triggerEvent('edit', { id: this.data.event.id }); } },
});
