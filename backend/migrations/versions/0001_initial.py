"""처음 스키마 — Alembic 이전에 쓰던 DB가 도착해 있는 지점.

Alembic을 도입하기 전의 DB 파일은 `db._apply_additive_migrations`가 컬럼을 하나씩
붙여가며 여기까지 와 있다. 그래서 `app.migrate`는 그런 파일을 만나면 이 리비전을
**다시 실행하지 않고 "여기까지 왔다"고 도장만 찍는다**(stamp). 이미 있는 테이블을
다시 만들려 들면 업데이트가 그 자리에서 멈춘다.

바꿔 말하면 이 파일은 **비어 있는 DB를 위한 것**이고, 내용은 그 시점의 모델과
정확히 같아야 한다. (`test_migrations.py`가 모델과의 차이를 매번 검사한다.)

Revision ID: 0001
Revises:
"""

from alembic import op
import sqlalchemy as sa


revision = '0001'
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table('krx_listing',
    sa.Column('code', sa.String(), nullable=False),
    sa.Column('name', sa.String(), nullable=False),
    sa.Column('board', sa.String(), nullable=False),
    sa.Column('instrument', sa.String(), nullable=False),
    sa.Column('updated_at', sa.DateTime(), nullable=False),
    sa.PrimaryKeyConstraint('code')
    )
    with op.batch_alter_table('krx_listing', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_krx_listing_name'), ['name'], unique=False)

    op.create_table('portfolio_settings',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('default_rebalance_band_pct', sa.Float(), nullable=False),
    sa.Column('base_currency', sa.String(), nullable=False),
    sa.Column('usd_krw_override', sa.Float(), nullable=True),
    sa.Column('usd_krw_rate', sa.Float(), nullable=True),
    sa.Column('usd_krw_updated_at', sa.DateTime(), nullable=True),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_table('stocks',
    sa.Column('ticker', sa.String(), nullable=False),
    sa.Column('name', sa.String(), nullable=True),
    sa.Column('category', sa.String(), nullable=True),
    sa.Column('market', sa.String(), nullable=False),
    sa.Column('currency', sa.String(), nullable=False),
    sa.Column('active', sa.Boolean(), nullable=False),
    sa.Column('added_at', sa.DateTime(), nullable=False),
    sa.Column('dca_amount', sa.Float(), nullable=False),
    sa.Column('dca_period', sa.Enum('monthly', 'quarterly', name='dcaperiod'), nullable=False),
    sa.Column('rebalance_period', sa.Enum('quarterly', 'semiannual', name='rebalanceperiod'), nullable=False),
    sa.Column('target_weight_pct', sa.Float(), nullable=False),
    sa.Column('rebalance_band_pct', sa.Float(), nullable=True),
    sa.Column('review_date_override', sa.Date(), nullable=True),
    sa.Column('sort_order', sa.Integer(), nullable=False),
    sa.PrimaryKeyConstraint('ticker')
    )
    op.create_table('buy_execution',
    sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
    sa.Column('ticker', sa.String(), nullable=False),
    sa.Column('period_start', sa.Date(), nullable=False),
    sa.Column('period_end', sa.Date(), nullable=False),
    sa.Column('exec_date', sa.Date(), nullable=False),
    sa.Column('type', sa.Enum('signal', 'fallback', name='buytype'), nullable=False),
    sa.Column('amount', sa.Float(), nullable=False),
    sa.Column('status', sa.Enum('scheduled', 'confirmed', name='buystatus'), nullable=False),
    sa.Column('confirmed_at', sa.DateTime(), nullable=True),
    sa.ForeignKeyConstraint(['ticker'], ['stocks.ticker'], ),
    sa.PrimaryKeyConstraint('id')
    )
    with op.batch_alter_table('buy_execution', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_buy_execution_ticker'), ['ticker'], unique=False)

    op.create_table('holding',
    sa.Column('ticker', sa.String(), nullable=False),
    sa.Column('quantity', sa.Float(), nullable=False),
    sa.Column('updated_at', sa.DateTime(), nullable=False),
    sa.ForeignKeyConstraint(['ticker'], ['stocks.ticker'], ),
    sa.PrimaryKeyConstraint('ticker')
    )
    op.create_table('indicator_daily',
    sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
    sa.Column('ticker', sa.String(), nullable=False),
    sa.Column('date', sa.Date(), nullable=False),
    sa.Column('ma5', sa.Float(), nullable=True),
    sa.Column('ma20', sa.Float(), nullable=True),
    sa.Column('ma50', sa.Float(), nullable=True),
    sa.Column('ma200', sa.Float(), nullable=True),
    sa.Column('stddev20', sa.Float(), nullable=True),
    sa.Column('vol_ma5', sa.Float(), nullable=True),
    sa.Column('vol_ma20', sa.Float(), nullable=True),
    sa.Column('vol_ratio', sa.Float(), nullable=True),
    sa.Column('roc5', sa.Float(), nullable=True),
    sa.Column('disparity', sa.Float(), nullable=True),
    sa.Column('plus_di', sa.Float(), nullable=True),
    sa.Column('minus_di', sa.Float(), nullable=True),
    sa.Column('adx', sa.Float(), nullable=True),
    sa.ForeignKeyConstraint(['ticker'], ['stocks.ticker'], ),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('ticker', 'date', name='uq_indicator_ticker_date')
    )
    with op.batch_alter_table('indicator_daily', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_indicator_daily_date'), ['date'], unique=False)
        batch_op.create_index(batch_op.f('ix_indicator_daily_ticker'), ['ticker'], unique=False)

    op.create_table('price_daily',
    sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
    sa.Column('ticker', sa.String(), nullable=False),
    sa.Column('date', sa.Date(), nullable=False),
    sa.Column('open', sa.Float(), nullable=False),
    sa.Column('high', sa.Float(), nullable=False),
    sa.Column('low', sa.Float(), nullable=False),
    sa.Column('close', sa.Float(), nullable=False),
    sa.Column('adj_close', sa.Float(), nullable=True),
    sa.Column('volume', sa.Float(), nullable=False),
    sa.Column('source', sa.String(), nullable=True),
    sa.ForeignKeyConstraint(['ticker'], ['stocks.ticker'], ),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('ticker', 'date', name='uq_price_ticker_date')
    )
    with op.batch_alter_table('price_daily', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_price_daily_date'), ['date'], unique=False)
        batch_op.create_index(batch_op.f('ix_price_daily_ticker'), ['ticker'], unique=False)

    op.create_table('signal_daily',
    sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
    sa.Column('ticker', sa.String(), nullable=False),
    sa.Column('date', sa.Date(), nullable=False),
    sa.Column('knee_buy_v2', sa.Boolean(), nullable=False),
    sa.Column('shoulder_sell_ref', sa.Boolean(), nullable=False),
    sa.ForeignKeyConstraint(['ticker'], ['stocks.ticker'], ),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('ticker', 'date', name='uq_signal_ticker_date')
    )
    with op.batch_alter_table('signal_daily', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_signal_daily_date'), ['date'], unique=False)
        batch_op.create_index(batch_op.f('ix_signal_daily_ticker'), ['ticker'], unique=False)

def downgrade() -> None:
    """전부 지운다 — 되돌릴 일이 있다면 백업에서 복구하는 편이 안전하다."""
    with op.batch_alter_table('signal_daily', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_signal_daily_ticker'))
        batch_op.drop_index(batch_op.f('ix_signal_daily_date'))

    op.drop_table('signal_daily')
    with op.batch_alter_table('price_daily', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_price_daily_ticker'))
        batch_op.drop_index(batch_op.f('ix_price_daily_date'))

    op.drop_table('price_daily')
    with op.batch_alter_table('indicator_daily', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_indicator_daily_ticker'))
        batch_op.drop_index(batch_op.f('ix_indicator_daily_date'))

    op.drop_table('indicator_daily')
    op.drop_table('holding')
    with op.batch_alter_table('buy_execution', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_buy_execution_ticker'))

    op.drop_table('buy_execution')
    op.drop_table('stocks')
    op.drop_table('portfolio_settings')
    with op.batch_alter_table('krx_listing', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_krx_listing_name'))

    op.drop_table('krx_listing')
