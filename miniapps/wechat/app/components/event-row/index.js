Component({
  properties: { event: Object, editLabel: String, sourceLabel: String, removeLabel: String },
  methods: {
    edit() { this.triggerEvent('edit', { id: this.data.event.id }); },
    remove() { this.triggerEvent('remove', { id: this.data.event.id }); },
  },
});
