"""JSON-file configuration repository."""

from backend import config_store


class JsonConfigRepository:
    def __init__(
        self,
        *,
        dashboard_path,
        groups_path,
        load_groups_config_file_fn,
        log_warning_fn=None,
    ):
        self.dashboard_path = dashboard_path
        self.groups_path = groups_path
        self.load_groups_config_file_fn = load_groups_config_file_fn
        self.log_warning_fn = log_warning_fn

    def load_dashboard_config(self):
        return config_store.load_dashboard_config(
            self.dashboard_path,
            self.groups_path,
            self.load_groups_config_file_fn,
            self.save_dashboard_config,
            log_warning_fn=self.log_warning_fn,
        )

    def save_dashboard_config(self, config):
        return config_store.save_dashboard_config(config, self.dashboard_path)
