"""Isolated review namespaces for the quarterly work-structure model.

Revision ID: 20261030_0022
Revises: 20261028_0021

Adds a nullable `configuration_id` to review schemas and views, a nullable integer `quarter_ordinal` to views,
widens the cell row kind to 16 characters and admits `initiative`. Every existing row keeps `configuration_id`
NULL: that is the Legacy namespace, retained byte-for-byte. Nothing is copied into a new namespace, no ordinal is
inferred for old rows and the migration performs no Jira I/O.

Uniqueness moves from ordinary nullable UNIQUE constraints to partial unique indexes, one for the NULL Legacy
namespace and one for non-null configurations, because NULLs never collide in a plain UNIQUE.

downgrade() refuses, before it changes any constraint, when any new-namespace schema or view, Initiative cell or
stamped quarter ordinal exists, since dropping the columns would silently merge or discard that data.
"""
from alembic import op
import sqlalchemy as sa

revision = '20261030_0022'
down_revision = '20261028_0021'
branch_labels = None
depends_on = None

SCHEMAS = 'workspace_group_review_schemas'
CELLS = 'group_review_cells'
VIEWS = 'group_sprint_review_views'
IS_NULL = sa.text('configuration_id IS NULL')
NOT_NULL = sa.text('configuration_id IS NOT NULL')


def _partial_index(name, table, columns, where):
    op.create_index(name, table, columns, unique=True, postgresql_where=where, sqlite_where=where)


def upgrade():
    with op.batch_alter_table(SCHEMAS) as batch:
        batch.add_column(sa.Column('configuration_id', sa.String(128), nullable=True))
        batch.drop_constraint('uq_group_review_schema_workspace_group', type_='unique')
    _partial_index('uq_group_review_schema_legacy', SCHEMAS, ['workspace_id', 'group_id'], IS_NULL)
    _partial_index('uq_group_review_schema_configuration', SCHEMAS, ['workspace_id', 'group_id', 'configuration_id'], NOT_NULL)

    with op.batch_alter_table(CELLS) as batch:
        batch.drop_constraint('ck_group_review_cell_row_kind', type_='check')
        batch.alter_column('row_kind', existing_type=sa.String(8), type_=sa.String(16), existing_nullable=False)
        batch.create_check_constraint('ck_group_review_cell_row_kind', "row_kind IN ('epic', 'story', 'initiative')")

    with op.batch_alter_table(VIEWS) as batch:
        batch.add_column(sa.Column('configuration_id', sa.String(128), nullable=True))
        batch.add_column(sa.Column('quarter_ordinal', sa.Integer(), nullable=True))
        batch.drop_constraint('uq_group_sprint_review_view', type_='unique')
    _partial_index('uq_group_sprint_review_view_legacy', VIEWS, ['workspace_id', 'group_id', 'sprint_id'], IS_NULL)
    _partial_index('uq_group_sprint_review_view_configuration', VIEWS,
                   ['workspace_id', 'group_id', 'sprint_id', 'configuration_id'], NOT_NULL)
    op.create_index('ix_group_sprint_review_views_quarter', VIEWS,
                    ['workspace_id', 'group_id', 'configuration_id', 'quarter_ordinal'],
                    postgresql_where=NOT_NULL, sqlite_where=NOT_NULL)


def _refuse_if_new_data():
    bind = op.get_bind()
    counts = {
        'configuration schemas': f'SELECT count(*) FROM {SCHEMAS} WHERE configuration_id IS NOT NULL',
        'configuration views': f'SELECT count(*) FROM {VIEWS} WHERE configuration_id IS NOT NULL OR quarter_ordinal IS NOT NULL',
        'Initiative cells': f"SELECT count(*) FROM {CELLS} WHERE row_kind = 'initiative'",
    }
    found = {label: bind.execute(sa.text(query)).scalar() for label, query in counts.items()}
    found = {label: count for label, count in found.items() if count}
    if found:
        raise RuntimeError('Refusing to downgrade 20261030_0022: new review namespace data exists ('
                           + ', '.join(f'{label}: {count}' for label, count in sorted(found.items()))
                           + '). Remove it deliberately first.')


def downgrade():
    _refuse_if_new_data()
    op.drop_index('ix_group_sprint_review_views_quarter', table_name=VIEWS)
    op.drop_index('uq_group_sprint_review_view_configuration', table_name=VIEWS)
    op.drop_index('uq_group_sprint_review_view_legacy', table_name=VIEWS)
    with op.batch_alter_table(VIEWS) as batch:
        batch.drop_column('quarter_ordinal')
        batch.drop_column('configuration_id')
        batch.create_unique_constraint('uq_group_sprint_review_view', ['workspace_id', 'group_id', 'sprint_id'])

    with op.batch_alter_table(CELLS) as batch:
        batch.drop_constraint('ck_group_review_cell_row_kind', type_='check')
        batch.alter_column('row_kind', existing_type=sa.String(16), type_=sa.String(8), existing_nullable=False)
        batch.create_check_constraint('ck_group_review_cell_row_kind', "row_kind IN ('epic', 'story')")

    op.drop_index('uq_group_review_schema_configuration', table_name=SCHEMAS)
    op.drop_index('uq_group_review_schema_legacy', table_name=SCHEMAS)
    with op.batch_alter_table(SCHEMAS) as batch:
        batch.drop_column('configuration_id')
        batch.create_unique_constraint('uq_group_review_schema_workspace_group', ['workspace_id', 'group_id'])
